/**
 * Sandboxed execution for proposed / generated skill code.
 *
 * Proposal code runs inside a `node:vm` context that lives in a short-lived
 * worker thread. The context holds only its own intrinsics: no
 * require/import, no process, no network, no timers, and code generation from
 * strings (eval / new Function) disabled. No host-realm object or function is
 * shared with the guest (see WORKER_SOURCE), which closes the
 * `constructor.constructor` escape.
 *
 * The worker gives a hard wall-clock limit (`worker.terminate()` stops even
 * `for (;;) await null` microtask loops, which a vm timeout cannot) and a
 * memory cap. Terminating a vm mid-microtask-drain is deliberately avoided:
 * it can trip a Node-internal assertion that aborts the whole process.
 *
 * NOTE: `node:vm` is still NOT a hard security boundary against engine-level
 * bugs. For untrusted code prefer GENERATED_SKILL_EXECUTION=backend
 * (docker / ssh). Generated skills therefore always carry riskLevel >=
 * 'medium', stay inactive unless listed in ENABLED_SKILLS, and execute behind
 * the Human-in-the-Loop / tool policy gate like any other skill.
 */

import { Worker } from 'node:worker_threads';
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
 * Worker-side program, kept as a self-contained string so it needs no separate
 * file in any bundler or test runner.
 *
 * The context is created empty: NOTHING from the host realm is injected, since
 * every object or function the guest can reach would expose the host
 * `Function` constructor via `x.constructor.constructor("return process")()`.
 * The context's own intrinsics (JSON, Math, Date, Map, Promise, ...) are used
 * instead, so host-only globals such as URL, TextEncoder and structuredClone
 * are not available to proposal code.
 *
 * Arguments cross the boundary as a JSON string parsed by the guest's own
 * JSON; the result comes back as a JSON string. The guest promise settles in
 * the guest realm and is read after the microtask queue has drained, so no
 * host callback is ever handed to guest code.
 */
const GUEST_PRELUDE =
  'var module = { exports: undefined }; var exports = module.exports;' +
  'var console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };';

const GUEST_INVOKER = [
  'var __result;',
  '(function () {',
  '  function fail(e) {',
  '    __result = JSON.stringify({ error: String(e && e.message !== undefined ? e.message : e) });',
  '  }',
  "  if (typeof module.exports !== 'function') {",
  '    __result = JSON.stringify({ noHandler: true });',
  '    return;',
  '  }',
  '  try {',
  '    var args = JSON.parse(__ARGS__);',
  '    Promise.resolve(module.exports(args)).then(function (v) {',
  '      try { __result = JSON.stringify({ value: v === undefined ? null : v }); } catch (e) { fail(e); }',
  '    }, fail);',
  '  } catch (e) { fail(e); }',
  '})();',
].join('\n');

const WORKER_SOURCE = [
  "const { parentPort, workerData } = require('node:worker_threads');",
  "const vm = require('node:vm');",
  'const { code, prelude, invoker, timeoutMs } = workerData;',
  'const post = (m) => parentPort.postMessage(m);',
  'const errText = (e) => String(e && e.message !== undefined ? e.message : e);',
  'try {',
  '  const context = vm.createContext(Object.create(null), {',
  '    codeGeneration: { strings: false, wasm: false },',
  '  });',
  '  new vm.Script(prelude).runInContext(context);',
  "  new vm.Script(code, { filename: 'generated-skill.js' }).runInContext(context, { timeout: timeoutMs });",
  "  new vm.Script(invoker, { filename: 'generated-skill-invoke.js' }).runInContext(context, { timeout: timeoutMs });",
  '  // Guest code has no timers or I/O: once the microtask queue has drained',
  '  // (before the next macrotask) a still-missing result can never arrive.',
  '  setImmediate(() => {',
  '    try {',
  "      const raw = new vm.Script(\"typeof __result === 'string' ? __result : undefined\").runInContext(context);",
  "      post(typeof raw === 'string' ? { raw } : { unsettled: true });",
  '    } catch (e) { post({ error: errText(e) }); }',
  '  });',
  '} catch (e) {',
  '  post({ error: errText(e) });',
  '}',
].join('\n');

/** Memory cap for one sandboxed invocation. */
const WORKER_MAX_OLD_GENERATION_MB = 64;

interface WorkerOutcome {
  raw?: string;
  error?: string;
  unsettled?: boolean;
  timedOut?: boolean;
}

/** Run one invocation in a fresh worker and hard-stop it at the deadline. */
function runInWorker(code: string, argsLiteral: string, timeoutMs: number): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        code,
        prelude: GUEST_PRELUDE,
        invoker: GUEST_INVOKER.replace('__ARGS__', () => argsLiteral),
        timeoutMs,
      },
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB, maxYoungGenerationSizeMb: 16 },
    });
    const finish = (outcome: WorkerOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void worker.terminate();
      resolve(outcome);
    };
    // Start the clock once the worker is running so startup cost is not billed.
    worker.once('online', () => {
      timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    });
    worker.once('message', (message: WorkerOutcome) => finish(message ?? {}));
    worker.once('error', (error) => finish({ error: error instanceof Error ? error.message : String(error) }));
    worker.once('exit', () => finish({ error: 'sandbox worker exited unexpectedly' }));
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
 * worker and vm context, so proposal code cannot accumulate state across calls.
 *
 * Sync loops are interrupted by the vm timeout inside the worker; everything
 * else (microtask loops, never-settling work, runaway memory) is bounded by
 * terminating the worker at the wall-clock deadline.
 */
export async function runProposalCode(
  code: string,
  args: Record<string, unknown>,
  options: SandboxRunOptions = {},
): Promise<SkillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let argsLiteral: string;
  try {
    argsLiteral = JSON.stringify(JSON.stringify(args ?? {}));
  } catch (error) {
    return errorResult(error);
  }

  const outcome = await runInWorker(code, argsLiteral, timeoutMs);
  if (outcome.timedOut || outcome.unsettled) {
    return errorResult(new Error(`timed out after ${timeoutMs}ms${outcome.unsettled ? ' (handler did not settle)' : ''}`));
  }
  if (outcome.error !== undefined) return errorResult(new Error(outcome.error));
  if (typeof outcome.raw !== 'string') return errorResult(new Error('sandbox returned no result'));

  let parsed: { error?: string; noHandler?: boolean; value?: unknown };
  try {
    parsed = JSON.parse(outcome.raw);
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
