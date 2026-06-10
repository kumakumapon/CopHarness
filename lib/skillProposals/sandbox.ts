/**
 * Sandboxed execution for proposed / generated skill code.
 *
 * Proposal code runs inside a `node:vm` context with a minimal set of
 * globals: no require/import, no process, no network, no timers, and code
 * generation from strings (eval / new Function) disabled.
 *
 * NOTE: `node:vm` is NOT a hard security boundary. This sandbox protects
 * against accidental misuse (filesystem/network/env access, runaway sync
 * loops), not against a determined attacker. Generated skills therefore
 * always carry riskLevel >= 'medium', stay inactive unless listed in
 * ENABLED_SKILLS, and execute behind the Human-in-the-Loop / tool policy
 * gate like any other skill.
 */

import * as vm from 'node:vm';
import type { SkillResult } from '../skill';
import type {
  SkillProposal,
  SkillProposalTestCase,
  SkillProposalTestResult,
} from './store';

/** Default wall-clock budget for one sandboxed handler invocation. */
const DEFAULT_TIMEOUT_MS = 3000;

/** Maximum length of detail previews recorded in test results. */
const DETAIL_PREVIEW_LENGTH = 200;

export interface SandboxRunOptions {
  /** Wall-clock budget per invocation (compile + sync run + async settle). */
  timeoutMs?: number;
}

/**
 * Expected contract for proposal code:
 *
 *   module.exports = async (args) => {
 *     return { content: '...', isError: false }; // or a plain string
 *   };
 */
const CONTRACT_HINT =
  'proposal code must assign `module.exports` an async function `(args) => SkillResult | string`';

function createSandboxContext(): vm.Context {
  const moduleObj: { exports: unknown } = { exports: undefined };
  const sandbox: Record<string, unknown> = {
    module: moduleObj,
    exports: moduleObj.exports,
    console: {
      log: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Map,
    Set,
    Promise,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    structuredClone,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  };
  return vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
}

function normalizeResult(value: unknown): SkillResult {
  if (typeof value === 'string') return { content: value };
  if (value && typeof value === 'object' && typeof (value as SkillResult).content === 'string') {
    const result = value as SkillResult;
    return { content: result.content, isError: result.isError === true };
  }
  // Allow simple serializable returns (numbers, arrays, plain objects).
  if (value !== undefined && value !== null) {
    try {
      return { content: JSON.stringify(value) };
    } catch {
      /* fall through */
    }
  }
  return {
    content: `Generated skill returned an unsupported value (${typeof value}); ${CONTRACT_HINT}`,
    isError: true,
  };
}

function errorResult(error: unknown): SkillResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: `Generated skill execution failed: ${message}`, isError: true };
}

/**
 * Compile and invoke proposal code with the given arguments inside a fresh
 * sandbox context. Each invocation gets its own context, so proposal code
 * cannot accumulate state across calls.
 *
 * Sync runaway loops are interrupted via the vm timeout; async work is
 * bounded by a Promise race (a misbehaving async loop cannot be force-killed
 * inside the same process — this is one reason generated skills stay behind
 * the approval gate).
 */
export async function runProposalCode(
  code: string,
  args: Record<string, unknown>,
  options: SandboxRunOptions = {},
): Promise<SkillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = createSandboxContext();

  try {
    const script = new vm.Script(code, { filename: 'generated-skill.js' });
    script.runInContext(context, { timeout: timeoutMs });
  } catch (error) {
    return errorResult(error);
  }

  const exported = (context as Record<string, unknown>).module as { exports: unknown };
  if (typeof exported?.exports !== 'function') {
    return { content: `Generated skill did not export a handler; ${CONTRACT_HINT}`, isError: true };
  }

  // Invoke through a script (not a direct call from host) so the synchronous
  // portion of the handler is still covered by the vm timeout.
  (context as Record<string, unknown>).__args = args;
  let invoked: unknown;
  try {
    invoked = new vm.Script('module.exports(__args)', { filename: 'generated-skill-invoke.js' })
      .runInContext(context, { timeout: timeoutMs });
  } catch (error) {
    return errorResult(error);
  }

  // Cross-realm safe thenable check: VM-realm promises fail host `instanceof`.
  const isThenable =
    invoked !== null &&
    (typeof invoked === 'object' || typeof invoked === 'function') &&
    typeof (invoked as PromiseLike<unknown>).then === 'function';
  if (!isThenable) {
    return normalizeResult(invoked);
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const settled = await Promise.race([
      Promise.resolve(invoked as PromiseLike<unknown>),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return normalizeResult(settled);
  } catch (error) {
    return errorResult(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function truncateDetail(text: string): string {
  if (text.length <= DETAIL_PREVIEW_LENGTH) return text;
  return `${text.slice(0, DETAIL_PREVIEW_LENGTH)}…`;
}

function evaluateExpectation(
  result: SkillResult,
  expect: SkillProposalTestCase['expect'],
): { passed: boolean; reason?: string } {
  const expectError = expect?.isError === true;
  if ((result.isError === true) !== expectError) {
    return {
      passed: false,
      reason: expectError
        ? `expected an error result but got success`
        : `expected success but got error`,
    };
  }
  if (expect?.equals !== undefined && result.content !== expect.equals) {
    return { passed: false, reason: `expected content to equal "${truncateDetail(expect.equals)}"` };
  }
  if (expect?.contains !== undefined && !result.content.includes(expect.contains)) {
    return { passed: false, reason: `expected content to contain "${truncateDetail(expect.contains)}"` };
  }
  return { passed: true };
}

export interface ProposalTestRun {
  passed: boolean;
  results: SkillProposalTestResult[];
}

/**
 * Run every test case in the proposal's testPlan against its proposedCode.
 * An empty testPlan fails: an untested proposal must never reach approval.
 */
export async function runProposalTests(
  proposal: Pick<SkillProposal, 'proposedCode' | 'testPlan'>,
  options: SandboxRunOptions = {},
): Promise<ProposalTestRun> {
  if (!proposal.testPlan || proposal.testPlan.length === 0) {
    return {
      passed: false,
      results: [{ index: 0, passed: false, detail: 'testPlan is empty: at least one test case is required' }],
    };
  }

  const results: SkillProposalTestResult[] = [];
  for (let index = 0; index < proposal.testPlan.length; index++) {
    const testCase = proposal.testPlan[index];
    const result = await runProposalCode(proposal.proposedCode, testCase.args ?? {}, options);
    const evaluation = evaluateExpectation(result, testCase.expect);
    results.push({
      index,
      passed: evaluation.passed,
      detail: evaluation.passed
        ? truncateDetail(result.content)
        : truncateDetail(`${evaluation.reason}; actual: ${result.content}`),
    });
  }

  return { passed: results.every((r) => r.passed), results };
}
