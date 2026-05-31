/**
 * CopHarness Evaluation CLI
 *
 * Runs the built-in (and any custom) evaluation test suite against the
 * configured LLM provider and prints a scored report.  Exits with code 1
 * if the CI gate threshold is not met.
 *
 * Usage:
 *   npm run eval
 *   EVAL_PASS_THRESHOLD=0.9 npm run eval
 *
 * Custom test cases can be loaded by setting EVAL_CASES_FILE to a JSON file
 * that exports an array of EvalTestCase objects.
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local if present (dev convenience)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

import { createAdapter, resolveProvider, resolveModel } from '../lib/adapterFactory';
import { runEvalSuite, summariseResults, type EvalResult } from '../lib/eval/evaluator';
import { checkCiGate } from '../lib/eval/ciGate';
import { builtinTestCases, type EvalTestCase } from '../lib/eval/testCases';

// Colour helpers (ANSI codes, gracefully degrade when unsupported)
const isTTY = process.stdout.isTTY;
const green = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const red   = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s);
const bold  = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m`  : s);
const dim   = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m`  : s);

function printResult(result: EvalResult, idx: number, total: number): void {
  const status = result.passed ? green('✔ PASS') : red('✘ FAIL');
  const score = `${(result.score * 100).toFixed(0)}%`;
  const duration = `${result.durationMs}ms`;
  console.log(`  [${idx + 1}/${total}] ${status} ${bold(result.name)}  ${dim(score)} ${dim(duration)}`);
  if (result.error) {
    console.log(`        ${red('Error:')} ${result.error}`);
  } else if (!result.passed && result.response) {
    const preview = result.response.slice(0, 120).replace(/\n/g, ' ');
    console.log(`        ${dim('Response:')} ${preview}…`);
  }
}

async function main(): Promise<void> {
  // Load test cases
  let testCases: EvalTestCase[] = [...builtinTestCases];
  const customFile = process.env.EVAL_CASES_FILE;
  if (customFile) {
    try {
      const raw = fs.readFileSync(path.resolve(customFile), 'utf-8');
      const custom = JSON.parse(raw) as EvalTestCase[];
      testCases = [...testCases, ...custom];
      console.log(dim(`  Loaded ${custom.length} custom test case(s) from ${customFile}`));
    } catch (err) {
      console.error(red(`  Failed to load EVAL_CASES_FILE: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // Create adapter
  const provider = resolveProvider();
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ||
    process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY;
  const model = resolveModel(provider);

  const adapter = createAdapter({ provider, model, apiKey, timeoutMs: 60_000 });

  console.log(bold('\nCopHarness Evaluation Suite'));
  console.log(dim(`  Provider: ${provider}  Model: ${model}  Cases: ${testCases.length}`));
  console.log('');

  // Run suite
  const results = await runEvalSuite(testCases, adapter, printResult);

  // Summary
  const stats = summariseResults(results);
  console.log('');
  console.log(bold('Results'));
  console.log(`  Passed:       ${green(String(stats.passed))} / ${stats.total}`);
  console.log(`  Pass rate:    ${stats.passRate >= 0.8 ? green : red}(${(stats.passRate * 100).toFixed(1)}%)`);
  console.log(`  Avg score:    ${(stats.avgScore * 100).toFixed(1)}%`);
  console.log(`  Avg duration: ${stats.avgDurationMs.toFixed(0)} ms`);
  console.log('');

  // CI gate
  const gate = checkCiGate(results);
  if (gate.ok) {
    console.log(green(`  ${gate.message}`));
  } else {
    console.log(red(`  ${gate.message}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(red(`Eval fatal error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
