/**
 * CI Quality Gate for agent evaluation.
 *
 * Exits with code 1 if the overall pass rate is below the configured threshold.
 * Intended to be used in CI pipelines after `npm run eval`.
 *
 * Threshold is read from EVAL_PASS_THRESHOLD env var (0–1, default: 0.8).
 */

import type { EvalResult } from './evaluator';
import { summariseResults } from './evaluator';

const DEFAULT_THRESHOLD = 0.8;

/**
 * Evaluate results against the CI threshold.
 * Returns { ok: true } if the gate passes, or { ok: false, message } if it fails.
 */
export function checkCiGate(results: EvalResult[]): { ok: boolean; message: string } {
  const threshold = Number(process.env.EVAL_PASS_THRESHOLD) || DEFAULT_THRESHOLD;
  const stats = summariseResults(results);

  if (stats.passRate >= threshold) {
    return {
      ok: true,
      message:
        `CI gate PASSED: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%) ` +
        `≥ threshold ${(threshold * 100).toFixed(0)}%`,
    };
  }

  return {
    ok: false,
    message:
      `CI gate FAILED: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%) ` +
      `< threshold ${(threshold * 100).toFixed(0)}%`,
  };
}
