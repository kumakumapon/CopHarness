/**
 * CI Quality Gate for agent evaluation.
 *
 * Threshold is read from EVAL_PASS_THRESHOLD (0–1, default: 0.8).
 */

import type { EvalResult } from './evaluator';
import { summariseResults } from './evaluator';

const DEFAULT_THRESHOLD = 0.8;

export interface CiGateResult {
  ok: boolean;
  message: string;
  threshold: number;
}

export function resolveCiThreshold(value = process.env.EVAL_PASS_THRESHOLD): number {
  if (value === undefined || value.trim() === '') return DEFAULT_THRESHOLD;
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('EVAL_PASS_THRESHOLD must be a number between 0 and 1');
  }
  return threshold;
}

export function checkCiGate(
  results: EvalResult[],
  threshold = resolveCiThreshold(),
): CiGateResult {
  const stats = summariseResults(results);

  if (stats.passRate >= threshold) {
    return {
      ok: true,
      threshold,
      message:
        `CI gate PASSED: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%) ` +
        `≥ threshold ${(threshold * 100).toFixed(0)}%`,
    };
  }

  return {
    ok: false,
    threshold,
    message:
      `CI gate FAILED: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%) ` +
      `< threshold ${(threshold * 100).toFixed(0)}%`,
  };
}
