import type { EvalResult } from '../../lib/eval/evaluator';
import type { CiGateResult } from '../../lib/eval/ciGate';
import {
  createEvalReport,
  formatJsonReport,
  formatJunitReport,
} from '../../lib/eval/reporters';

const results: EvalResult[] = [
  {
    name: 'passes',
    prompt: 'prompt',
    mode: 'exact',
    response: 'ok',
    score: 1,
    passed: true,
    threshold: 1,
    durationMs: 100,
  },
  {
    name: 'fails & <escapes>',
    prompt: 'prompt',
    mode: 'contains',
    response: 'wrong <value>',
    score: 0,
    passed: false,
    threshold: 1,
    durationMs: 250,
  },
];

const gate: CiGateResult = {
  ok: false,
  threshold: 0.8,
  message: 'CI gate FAILED',
};

describe('eval reporters', () => {
  const report = createEvalReport(
    results,
    gate,
    'mock',
    'mock-model',
    '2026-01-01T00:00:00.000Z',
  );

  test('builds a versioned JSON report with summary and gate data', () => {
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.summary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
    });
    expect(parsed.gate).toEqual(gate);
    expect(parsed.results).toHaveLength(2);
  });

  test('builds JUnit XML and escapes user-controlled values', () => {
    const xml = formatJunitReport(report);
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('time="0.350"');
    expect(xml).toContain('fails &amp; &lt;escapes&gt;');
    expect(xml).toContain('wrong &lt;value&gt;');
    expect(xml).toContain('<failure');
  });

  test('represents adapter errors as JUnit errors', () => {
    const errorResult: EvalResult = {
      ...results[1],
      name: 'network error',
      error: 'timeout & retry',
    };
    const errorReport = createEvalReport(
      [errorResult],
      gate,
      'mock',
      'mock-model',
      '2026-01-01T00:00:00.000Z',
    );
    const xml = formatJunitReport(errorReport);
    expect(xml).toContain('errors="1"');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('<error message="timeout &amp; retry">');
  });
});
