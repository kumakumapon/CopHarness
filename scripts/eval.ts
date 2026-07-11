/**
 * CopHarness Evaluation CLI
 *
 * Usage:
 *   npm run eval
 *   npm run eval -- --json
 *   npm run eval -- --junit --output reports/eval.xml
 */

import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
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
import { createEvalReport, formatJsonReport, formatJunitReport } from '../lib/eval/reporters';
import { builtinTestCases, type EvalTestCase } from '../lib/eval/testCases';

type OutputFormat = 'human' | 'json' | 'junit';

function parseArgs(args: string[]): { format: OutputFormat; output?: string } {
  let format: OutputFormat = 'human';
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' || arg === '--junit') {
      if (format !== 'human') throw new Error('Specify only one output format');
      format = arg.slice(2) as OutputFormat;
    } else if (arg === '--output') {
      output = args[++i];
      if (!output) throw new Error('--output requires a file path');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { format, output };
}

const isTTY = process.stdout.isTTY;
const green = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function printResult(result: EvalResult, idx: number, total: number): void {
  const status = result.passed ? green('✔ PASS') : red('✘ FAIL');
  console.log(`  [${idx + 1}/${total}] ${status} ${bold(result.name)}  ${dim(`${(result.score * 100).toFixed(0)}%`)} ${dim(`${result.durationMs}ms`)}`);
  if (result.error) console.log(`        ${red('Error:')} ${result.error}`);
}

function writeOutput(value: string, output?: string): void {
  if (output) {
    const outputPath = path.resolve(output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, value + '\n', 'utf-8');
  } else {
    process.stdout.write(value + '\n');
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const machineReadable = options.format !== 'human';
  let testCases: EvalTestCase[] = [...builtinTestCases];
  const customFile = process.env.EVAL_CASES_FILE;
  if (customFile) {
    const raw = fs.readFileSync(path.resolve(customFile), 'utf-8');
    const custom = JSON.parse(raw) as EvalTestCase[];
    testCases = [...testCases, ...custom];
    if (!machineReadable) console.log(dim(`  Loaded ${custom.length} custom test case(s) from ${customFile}`));
  }

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

  if (!machineReadable) {
    console.log(bold('\nCopHarness Evaluation Suite'));
    console.log(dim(`  Provider: ${provider}  Model: ${model}  Cases: ${testCases.length}`));
    console.log('');
  }

  const results = await runEvalSuite(testCases, adapter, machineReadable ? undefined : printResult);
  const stats = summariseResults(results);
  const gate = checkCiGate(results);

  if (options.format === 'json') {
    writeOutput(formatJsonReport(createEvalReport(results, gate, provider, model)), options.output);
  } else if (options.format === 'junit') {
    writeOutput(formatJunitReport(createEvalReport(results, gate, provider, model)), options.output);
  } else {
    console.log('');
    console.log(bold('Results'));
    console.log(`  Passed:       ${green(String(stats.passed))} / ${stats.total}`);
    console.log(`  Pass rate:    ${stats.passRate >= 0.8 ? green : red}(${(stats.passRate * 100).toFixed(1)}%)`);
    console.log(`  Avg score:    ${(stats.avgScore * 100).toFixed(1)}%`);
    console.log(`  Avg duration: ${stats.avgDurationMs.toFixed(0)} ms\n`);
    console.log(gate.ok ? green(`  ${gate.message}`) : red(`  ${gate.message}`));
  }

  process.exitCode = gate.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(red(`Eval fatal error: ${err instanceof Error ? err.message : String(err)}`));
  process.exitCode = 2;
});
