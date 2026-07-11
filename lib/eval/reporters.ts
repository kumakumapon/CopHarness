import type { EvalResult } from './evaluator';
import { summariseResults } from './evaluator';
import type { CiGateResult } from './ciGate';

export interface EvalReport {
  schemaVersion: 1;
  generatedAt: string;
  provider: string;
  model: string;
  summary: ReturnType<typeof summariseResults>;
  gate: CiGateResult;
  results: EvalResult[];
}

export function createEvalReport(
  results: EvalResult[],
  gate: CiGateResult,
  provider: string,
  model: string,
  generatedAt = new Date().toISOString(),
): EvalReport {
  return {
    schemaVersion: 1,
    generatedAt,
    provider,
    model,
    summary: summariseResults(results),
    gate,
    results,
  };
}

export function formatJsonReport(report: EvalReport): string {
  return JSON.stringify(report, null, 2);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatJunitReport(report: EvalReport): string {
  const { summary, results } = report;
  const durationSeconds = results.reduce((sum, result) => sum + result.durationMs, 0) / 1000;
  const cases = results.map((result) => {
    const attributes =
      `name="${escapeXml(result.name)}" classname="eval.${escapeXml(result.mode)}" time="${(result.durationMs / 1000).toFixed(3)}"`;
    if (result.error) {
      return `  <testcase ${attributes}><error message="${escapeXml(result.error)}">${escapeXml(result.error)}</error></testcase>`;
    }
    if (!result.passed) {
      const message = `score ${result.score} below threshold ${result.threshold}`;
      return `  <testcase ${attributes}><failure message="${escapeXml(message)}">${escapeXml(result.response)}</failure></testcase>`;
    }
    return `  <testcase ${attributes} />`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="CopHarness eval" tests="${summary.total}" failures="${summary.failed}" errors="${results.filter((result) => result.error).length}" time="${durationSeconds.toFixed(3)}" timestamp="${escapeXml(report.generatedAt)}">`,
    ...cases,
    '</testsuite>',
  ].join('\n');
}
