/**
 * Agent evaluation engine.
 *
 * Runs EvalTestCase definitions against the configured LLM adapter and
 * returns scored EvalResult objects.  Supports four scoring modes:
 *   - exact    : trimmed case-insensitive equality
 *   - contains : case-insensitive substring match
 *   - regex    : RegExp test against the response
 *   - llm_judge: a secondary LLM call rates the response 0–10
 */

import type { LLMAdapter, LLMMessage } from '../adapter';
import { listActiveSkills } from '../skill';
import type { EvalTestCase, ScoringMode } from './testCases';

export interface EvalResult {
  name: string;
  prompt: string;
  mode: ScoringMode;
  response: string;
  score: number;
  /** True when score ≥ threshold. */
  passed: boolean;
  threshold: number;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function scoreExact(response: string, expected: string): number {
  return response.trim().toLowerCase() === expected.trim().toLowerCase() ? 1 : 0;
}

function scoreContains(response: string, expected: string): number {
  return response.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
}

function scoreRegex(response: string, pattern: string): number {
  try {
    return new RegExp(pattern, 'i').test(response) ? 1 : 0;
  } catch {
    return 0;
  }
}

async function scoreLlmJudge(
  response: string,
  judgePrompt: string,
  adapter: LLMAdapter,
): Promise<number> {
  const filledPrompt = judgePrompt.replace('{{response}}', response);
  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are an evaluation judge. Reply with ONLY a single integer 0–10.' },
    { role: 'user', content: filledPrompt },
  ];
  try {
    const resp = await adapter.complete({ messages, timeoutMs: 20_000 });
    const raw = resp.content.trim().replace(/[^0-9]/g, '');
    const score = parseInt(raw, 10);
    if (isNaN(score)) return 0;
    return Math.min(10, Math.max(0, score)) / 10;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Default thresholds
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD_DETERMINISTIC = 1.0;
const DEFAULT_THRESHOLD_LLM_JUDGE = 0.6;

// ---------------------------------------------------------------------------
// Core evaluator
// ---------------------------------------------------------------------------

/**
 * Run a single test case and return a scored EvalResult.
 */
export async function runTestCase(
  testCase: EvalTestCase,
  adapter: LLMAdapter,
): Promise<EvalResult> {
  const threshold =
    testCase.threshold ??
    (testCase.mode === 'llm_judge'
      ? DEFAULT_THRESHOLD_LLM_JUDGE
      : DEFAULT_THRESHOLD_DETERMINISTIC);

  const skills = listActiveSkills();
  const messages: LLMMessage[] = [
    { role: 'user', content: testCase.prompt },
  ];

  const start = Date.now();
  let response = '';
  let error: string | undefined;

  try {
    const resp = await adapter.complete({ messages, skills, timeoutMs: 60_000 });
    response = resp.content;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    return {
      name: testCase.name,
      prompt: testCase.prompt,
      mode: testCase.mode,
      response: '',
      score: 0,
      passed: false,
      threshold,
      durationMs: Date.now() - start,
      error,
    };
  }

  const durationMs = Date.now() - start;

  let score = 0;
  switch (testCase.mode) {
    case 'exact':
      score = testCase.expected ? scoreExact(response, testCase.expected) : 0;
      break;
    case 'contains':
      score = testCase.expected ? scoreContains(response, testCase.expected) : 0;
      break;
    case 'regex':
      score = testCase.expected ? scoreRegex(response, testCase.expected) : 0;
      break;
    case 'llm_judge':
      score = testCase.judgePrompt
        ? await scoreLlmJudge(response, testCase.judgePrompt, adapter)
        : 0;
      break;
  }

  return {
    name: testCase.name,
    prompt: testCase.prompt,
    mode: testCase.mode,
    response,
    score,
    passed: score >= threshold,
    threshold,
    durationMs,
    error,
  };
}

/**
 * Run all test cases sequentially and return their results.
 * Pass a `onProgress` callback to receive incremental updates.
 */
export async function runEvalSuite(
  testCases: EvalTestCase[],
  adapter: LLMAdapter,
  onProgress?: (result: EvalResult, index: number, total: number) => void,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (let i = 0; i < testCases.length; i++) {
    const result = await runTestCase(testCases[i], adapter);
    results.push(result);
    onProgress?.(result, i, testCases.length);
  }
  return results;
}

/** Compute summary statistics from a list of results. */
export function summariseResults(results: EvalResult[]): {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgScore: number;
  avgDurationMs: number;
} {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;
  const avgScore = total > 0 ? results.reduce((s, r) => s + r.score, 0) / total : 0;
  const avgDurationMs = total > 0 ? results.reduce((s, r) => s + r.durationMs, 0) / total : 0;
  return { total, passed, failed, passRate, avgScore, avgDurationMs };
}
