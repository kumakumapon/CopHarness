/**
 * Sandboxed execution for proposed / generated skill code.
 *
 * Proposal code runs inside a `node:vm` context that contains only the
 * context's own intrinsics: no require/import, no process, no network, no
 * timers, and code generation from strings (eval / new Function) disabled.
 * No host-realm object or function is shared with the guest (see
 * createSandboxContext), which closes the `constructor.constructor` escape.
 *
 * NOTE: `node:vm` is still NOT a hard security boundary (e.g. memory
 * exhaustion, engine-level bugs). For untrusted code prefer
 * GENERATED_SKILL_EXECUTION=backend (docker / ssh). Generated skills therefore
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

/**
 * Create an empty context. NOTHING from the host realm is injected: every
 * object or function the guest can reach would expose the host `Function`
 * constructor via `x.constructor.constructor("return process")()`, which is a
 * full sandbox escape. The context's own intrinsics (JSON, Math, Date, Map,
 * Promise, ...) are used instead. As a consequence host-only globals such as
 * URL, TextEncoder and structuredClone are not available to proposal code.
 */
function createSandboxContext(): vm.Context {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    // Drain the guest's microtask queue inside runInContext so the vm timeout
    // also bounds async code (e.g. `for (;;) await null`).
    microtaskMode: 'afterEvaluate',
  });
  new vm.Script(
    'var module = { exports: undefined }; var exports = module.exports;' +
      'var console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };',
  ).runInContext(context);
  return context;
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
 * Both sync loops and microtask loops are interrupted via the vm timeout
 * (`microtaskMode: 'afterEvaluate'`). Guest code has no timers, so a promise
 * still pending after evaluation can never settle and is reported as timed out.
 */
export async function runProposalCode(
  code: string,
  args: Record<string, unknown>,
  options: SandboxRunOptions = {},
): Promise<SkillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = createSandboxContext();

  // Arguments cross the boundary as a JSON *string* and are parsed by the
  // guest's own JSON, so no host object is ever reachable from guest code.
  let argsLiteral: string;
  try {
    argsLiteral = JSON.stringify(JSON.stringify(args ?? {}));
  } catch (error) {
    return errorResult(error);
  }

  try {
    new vm.Script(code, { filename: 'generated-skill.js' }).runInContext(context, { timeout: timeoutMs });
  } catch (error) {
    return errorResult(error);
  }

  // The invoker runs entirely in the guest realm and reports back through a
  // single string global, so no host callback (and no host Promise adoption
  // of a guest thenable) is involved.
  const invoker = `
    var __result;
    (function () {
      function fail(e) {
        __result = JSON.stringify({ error: String(e && e.message !== undefined ? e.message : e) });
      }
      if (typeof module.exports !== 'function') {
        __result = JSON.stringify({ noHandler: true });
        return;
      }
      try {
        var args = JSON.parse(${argsLiteral});
        Promise.resolve(module.exports(args)).then(function (v) {
          try { __result = JSON.stringify({ value: v === undefined ? null : v }); } catch (e) { fail(e); }
        }, fail);
      } catch (e) { fail(e); }
    })();
  `;
  try {
    new vm.Script(invoker, { filename: 'generated-skill-invoke.js' }).runInContext(context, { timeout: timeoutMs });
  } catch (error) {
    return errorResult(error);
  }

  const raw: unknown = new vm.Script("typeof __result === 'string' ? __result : undefined").runInContext(context);
  if (typeof raw !== 'string') {
    return errorResult(new Error(`timed out after ${timeoutMs}ms (handler did not settle)`));
  }
  let parsed: { error?: string; noHandler?: boolean; value?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return errorResult(error);
  }
  if (parsed.noHandler) {
    return { content: `Generated skill did not export a handler; ${CONTRACT_HINT}`, isError: true };
  }
  if (parsed.error !== undefined) return errorResult(new Error(parsed.error));
  return normalizeResult(parsed.value);
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
 *
 * @param proposal - The proposal whose code and test plan to run.
 * @param options  - Sandbox run options (timeout, etc.).
 * @param runner   - Optional custom runner (e.g. backend runner). Defaults to
 *                   `runProposalCode` so existing callers are unaffected.
 */
export async function runProposalTests(
  proposal: Pick<SkillProposal, 'proposedCode' | 'testPlan'>,
  options: SandboxRunOptions = {},
  runner: (code: string, args: Record<string, unknown>, opts: SandboxRunOptions) => Promise<SkillResult> = runProposalCode,
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
    const result = await runner(proposal.proposedCode, testCase.args ?? {}, options);
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
