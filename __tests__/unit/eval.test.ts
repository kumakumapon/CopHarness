import { runTestCase, summariseResults, type EvalResult } from '../../lib/eval/evaluator';
import { checkCiGate } from '../../lib/eval/ciGate';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../../lib/adapter';

// ---------------------------------------------------------------------------
// Mock adapter — returns a fixed response
// ---------------------------------------------------------------------------

function makeMockAdapter(response: string): LLMAdapter {
  return {
    provider: 'mock',
    model: 'mock-model',
    async complete(_req: LLMRequest): Promise<LLMResponse> {
      return { content: response, provider: 'mock', model: 'mock-model' };
    },
  };
}

// ---------------------------------------------------------------------------
// Scoring mode tests
// ---------------------------------------------------------------------------

describe('runTestCase – exact mode', () => {
  test('passes when response matches expected (case-insensitive)', async () => {
    const result = await runTestCase(
      { name: 'test', prompt: 'p', mode: 'exact', expected: 'Hello World' },
      makeMockAdapter('hello world'),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  test('fails when response does not match', async () => {
    const result = await runTestCase(
      { name: 'test', prompt: 'p', mode: 'exact', expected: 'Hello World' },
      makeMockAdapter('Goodbye'),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });
});

describe('runTestCase – contains mode', () => {
  test('passes when response contains expected substring', async () => {
    const result = await runTestCase(
      { name: 'test', prompt: 'p', mode: 'contains', expected: '51' },
      makeMockAdapter('The answer is 51.'),
    );
    expect(result.passed).toBe(true);
  });

  test('fails when expected substring absent', async () => {
    const result = await runTestCase(
      { name: 'test', prompt: 'p', mode: 'contains', expected: '999' },
      makeMockAdapter('The answer is 51.'),
    );
    expect(result.passed).toBe(false);
  });
});

describe('runTestCase – regex mode', () => {
  test('passes when response matches pattern', async () => {
    const result = await runTestCase(
      { name: 'test', prompt: 'p', mode: 'regex', expected: '\\d{4}-\\d{2}-\\d{2}' },
      makeMockAdapter('Today is 2024-05-30.'),
    );
    expect(result.passed).toBe(true);
  });

  test('fails when response does not match pattern', async () => {
    const result = await runTestCase(
      { name: 'test', prompt: 'p', mode: 'regex', expected: '\\d{4}-\\d{2}-\\d{2}' },
      makeMockAdapter('Today is Thursday.'),
    );
    expect(result.passed).toBe(false);
  });
});

describe('runTestCase – llm_judge mode', () => {
  test('interprets judge score ≥ threshold as pass', async () => {
    // Second call (judge call) returns "8"
    let callCount = 0;
    const adapter: LLMAdapter = {
      provider: 'mock',
      model: 'mock',
      async complete(): Promise<LLMResponse> {
        callCount++;
        return { content: callCount === 1 ? 'Paris is the capital of France.' : '8' };
      },
    };
    const result = await runTestCase(
      {
        name: 'test',
        prompt: 'p',
        mode: 'llm_judge',
        judgePrompt: 'Score 0–10: {{response}}',
        threshold: 0.6,
      },
      adapter,
    );
    expect(result.score).toBeCloseTo(0.8); // 8/10
    expect(result.passed).toBe(true);
  });

  test('fails when judge score below threshold', async () => {
    let callCount = 0;
    const adapter: LLMAdapter = {
      provider: 'mock',
      model: 'mock',
      async complete(): Promise<LLMResponse> {
        callCount++;
        return { content: callCount === 1 ? 'Dunno.' : '3' };
      },
    };
    const result = await runTestCase(
      {
        name: 'test',
        prompt: 'p',
        mode: 'llm_judge',
        judgePrompt: 'Score: {{response}}',
        threshold: 0.6,
      },
      adapter,
    );
    expect(result.score).toBeCloseTo(0.3);
    expect(result.passed).toBe(false);
  });
});

describe('runTestCase – adapter error', () => {
  test('returns score 0 and error message on adapter failure', async () => {
    const adapter: LLMAdapter = {
      provider: 'mock',
      model: 'mock',
      async complete(): Promise<LLMResponse> {
        throw new Error('Network timeout');
      },
    };
    const result = await runTestCase(
      { name: 'test', prompt: 'p', mode: 'contains', expected: 'Paris' },
      adapter,
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.error).toMatch(/Network timeout/);
  });
});

// ---------------------------------------------------------------------------
// summariseResults
// ---------------------------------------------------------------------------

describe('summariseResults', () => {
  const mockResults: EvalResult[] = [
    { name: 'a', prompt: '', mode: 'exact', response: '', score: 1, passed: true, threshold: 1, durationMs: 100 },
    { name: 'b', prompt: '', mode: 'exact', response: '', score: 0, passed: false, threshold: 1, durationMs: 200 },
    { name: 'c', prompt: '', mode: 'contains', response: '', score: 1, passed: true, threshold: 1, durationMs: 150 },
  ];

  test('calculates pass rate correctly', () => {
    const stats = summariseResults(mockResults);
    expect(stats.total).toBe(3);
    expect(stats.passed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.passRate).toBeCloseTo(2 / 3);
  });

  test('calculates avgScore and avgDurationMs', () => {
    const stats = summariseResults(mockResults);
    expect(stats.avgScore).toBeCloseTo(2 / 3);
    expect(stats.avgDurationMs).toBeCloseTo(150);
  });
});

// ---------------------------------------------------------------------------
// CI gate
// ---------------------------------------------------------------------------

describe('checkCiGate', () => {
  const makeResults = (passCount: number, total: number): EvalResult[] =>
    Array.from({ length: total }, (_, i) => ({
      name: `test-${i}`,
      prompt: '',
      mode: 'exact' as const,
      response: '',
      score: i < passCount ? 1 : 0,
      passed: i < passCount,
      threshold: 1,
      durationMs: 0,
    }));

  test('returns ok=true when pass rate ≥ threshold', () => {
    process.env.EVAL_PASS_THRESHOLD = '0.8';
    const gate = checkCiGate(makeResults(9, 10));
    expect(gate.ok).toBe(true);
    delete process.env.EVAL_PASS_THRESHOLD;
  });

  test('returns ok=false when pass rate < threshold', () => {
    process.env.EVAL_PASS_THRESHOLD = '0.8';
    const gate = checkCiGate(makeResults(7, 10));
    expect(gate.ok).toBe(false);
    delete process.env.EVAL_PASS_THRESHOLD;
  });

  test('uses default threshold 0.8 when env var not set', () => {
    delete process.env.EVAL_PASS_THRESHOLD;
    const gate = checkCiGate(makeResults(8, 10)); // 80% = exactly at threshold
    expect(gate.ok).toBe(true);
  });
});
