/**
 * Backend-based execution for generated / proposal skill code.
 *
 * Unlike the default `node:vm` sandbox, this runner delegates execution to
 * the configured ExecutionBackend (local / docker / ssh).  The generated code
 * runs as a real Node.js child process, which means it has FULL Node.js
 * capabilities — no artificial global restrictions.
 *
 * ⚠ SECURITY NOTE:
 *   In backend mode the code runs with full Node.js privileges.  Isolation is
 *   the RESPONSIBILITY OF THE BACKEND (container / remote host).  Using the
 *   "local" backend in backend mode is LESS isolated than the default vm
 *   sandbox.  Only opt in via GENERATED_SKILL_EXECUTION=backend when the
 *   backend itself provides a proper isolation boundary (e.g. docker, ssh to
 *   a sandboxed host).
 */

import { createHash } from 'node:crypto';
import { getExecutionBackend } from '../execution';
import type { SkillResult } from '../skill';

/** Marker prefix injected by the wrapper script to carry the serialised result. */
const RESULT_MARKER = '__COPHARNESS_SKILL_RESULT__';

/** Default wall-clock budget for one backend invocation. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum characters taken from stdout/stderr when reporting an unexpected failure. */
const PREVIEW_LENGTH = 200;

/**
 * Build the Node.js wrapper script that:
 *  1. Defines `module` / `exports` so the proposal code can assign
 *     `module.exports = async (args) => SkillResult | string`.
 *  2. Reads args from `process.argv[2]` (JSON-encoded).
 *  3. Reads timeoutMs from `process.argv[3]` and enforces it internally with a
 *     `setTimeout` keepalive — this ensures that a handler returning a never-
 *     settling Promise (e.g. `new Promise(() => {})`) is detected as a timeout
 *     rather than causing an instant clean exit when the event-loop drains.
 *  4. Awaits the handler, normalises the result, and emits it via the marker.
 *  5. Catches any handler exception and emits an isError result (exit 0).
 *
 * Normalisation logic mirrors `normalizeResult` in sandbox.ts.
 */
function buildWrapperScript(code: string): string {
  // The code is embedded verbatim — the outer IIFE provides a fresh module/exports scope.
  return `
(function () {
  const module = { exports: undefined };
  const exports = module.exports;

  // ---- BEGIN PROPOSAL CODE ----
  ${code}
  // ---- END PROPOSAL CODE ----

  const MARKER = ${JSON.stringify(RESULT_MARKER)};

  function normalizeResult(value) {
    if (typeof value === 'string') return { content: value };
    if (value && typeof value === 'object' && typeof value.content === 'string') {
      return { content: value.content, isError: value.isError === true };
    }
    if (value !== undefined && value !== null) {
      try { return { content: JSON.stringify(value) }; } catch (_) {}
    }
    return {
      content: 'Generated skill returned an unsupported value (' + typeof value + '); ' +
               'proposal code must assign \`module.exports\` an async function \`(args) => SkillResult | string\`',
      isError: true,
    };
  }

  // Keep the event-loop alive until the handler settles (or the timeout fires).
  // Without this, a handler that returns a never-settling Promise (e.g.
  // new Promise(() => {})) would cause the process to exit cleanly before
  // the timeout fires, because the event-loop drains with no active handles.
  // The timer is intentionally NOT unref-d so that it holds the event-loop open.
  const timeoutMs = parseInt(process.argv[3] || '10000', 10) || 10000;
  const keepaliveTimer = setTimeout(() => {
    // Handler did not settle within timeoutMs — emit a timeout marker and exit.
    console.log(MARKER + JSON.stringify({
      content: 'Generated skill timed out after ' + timeoutMs + 'ms',
      isError: true,
    }));
    process.exit(0);
  }, timeoutMs);

  async function main() {
    let args = {};
    try { args = JSON.parse(process.argv[2] || '{}'); } catch (_) {}

    if (typeof module.exports !== 'function') {
      clearTimeout(keepaliveTimer);
      console.log(MARKER + JSON.stringify({
        content: 'Generated skill did not export a handler; proposal code must assign \`module.exports\` an async function \`(args) => SkillResult | string\`',
        isError: true,
      }));
      return;
    }

    try {
      const raw = await module.exports(args);
      clearTimeout(keepaliveTimer);
      console.log(MARKER + JSON.stringify(normalizeResult(raw)));
    } catch (err) {
      clearTimeout(keepaliveTimer);
      const message = err instanceof Error ? err.message : String(err);
      console.log(MARKER + JSON.stringify({
        content: 'Generated skill execution failed: ' + message,
        isError: true,
      }));
    }
  }

  main().catch((err) => {
    clearTimeout(keepaliveTimer);
    const message = err instanceof Error ? err.message : String(err);
    console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify({
      content: 'Generated skill execution failed (unexpected): ' + message,
      isError: true,
    }));
  });
})();
`;
}

/**
 * Derive a deterministic filename from the proposal code so that identical
 * code always maps to the same file.  Residual files are harmless — they are
 * simply overwritten on the next call with the same code.
 */
function codeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16);
}

/**
 * Execute proposal code on the configured ExecutionBackend and return a
 * SkillResult.  Never throws — all error paths produce an isError result.
 *
 * @param code     - Proposal code string (must assign `module.exports`).
 * @param args     - Arguments forwarded to the handler.
 * @param options  - Optional timeout override.
 */
export async function runProposalCodeOnBackend(
  code: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<SkillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backend = getExecutionBackend();
  const hash = codeHash(code);
  const relativePath = `generated_skills/${hash}.js`;

  // 1. Write wrapper script.
  //    Same code always produces the same file — residual files are harmless.
  let absolutePath: string;
  try {
    const writeResult = await backend.writeFile({
      relativePath,
      content: buildWrapperScript(code),
    });
    absolutePath = writeResult.path;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Generated skill backend setup failed: ${message}`, isError: true };
  }

  // 2. Determine the script path to pass to node.
  //    - local: runCommand uses process.cwd() as cwd, so we need the absolute path.
  //    - docker / ssh: runCommand uses the backend workdir, so the relative path
  //      (written inside workdir) is sufficient.
  const scriptPath = backend.kind === 'local' ? absolutePath : relativePath;

  // 3. Execute.
  let cmdResult;
  try {
    cmdResult = await backend.runCommand({
      command: 'node',
      // argv[2] = JSON-encoded args, argv[3] = timeout budget for the internal keepalive
      args: [scriptPath, JSON.stringify(args), String(timeoutMs)],
      // Add a small buffer so the backend timeout fires AFTER the internal one
      timeoutMs: timeoutMs + 2000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Generated skill backend execution error: ${message}`, isError: true };
  }

  // 4. Interpret result.
  if (cmdResult.timedOut) {
    return { content: `Generated skill timed out after ${timeoutMs}ms`, isError: true };
  }

  // Scan stdout for the last occurrence of the result marker.
  const lines = cmdResult.stdout.split('\n');
  let lastMarkerResult: SkillResult | null = null;
  for (const line of lines) {
    const idx = line.indexOf(RESULT_MARKER);
    if (idx !== -1) {
      const jsonStr = line.slice(idx + RESULT_MARKER.length);
      try {
        const parsed = JSON.parse(jsonStr) as SkillResult;
        lastMarkerResult = parsed;
      } catch {
        // malformed marker line — keep scanning
      }
    }
  }

  if (lastMarkerResult !== null) {
    return lastMarkerResult;
  }

  // No marker found — unexpected failure.
  const preview = (cmdResult.stderr || cmdResult.stdout).slice(0, PREVIEW_LENGTH);
  if (cmdResult.exitCode !== 0) {
    return {
      content: `Generated skill exited with code ${cmdResult.exitCode}: ${preview}`,
      isError: true,
    };
  }
  return {
    content: `Generated skill produced no output (exitCode=${cmdResult.exitCode}): ${preview}`,
    isError: true,
  };
}
