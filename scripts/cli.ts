/**
 * CopHarness CLI
 * Interactive command-line interface for conversing with an LLM.
 *
 * Usage:
 *   npm run cli
 *
 * Environment variables (same as the web API):
 *   GITHUB_COPILOT_API_KEY / COPILOT_PROVIDER_API_KEY / OPENAI_API_KEY / etc.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

import { createAdapter, resolveProvider } from '../lib/adapterFactory';
import { type LLMMessage } from '../lib/adapter';

const SYSTEM_PROMPT = process.env.COPILOT_SYSTEM_PROMPT ?? '';

async function main() {
  const provider = resolveProvider();
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ||
    process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (!apiKey && provider !== 'copilot') {
    console.error(
      'Error: No API key found. Set one of: GITHUB_COPILOT_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY',
    );
    process.exit(1);
  }

  const model =
    process.env.COPILOT_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.GEMINI_MODEL ||
    'gpt-5-mini';

  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;

  const adapter = createAdapter({ provider, model, apiKey, timeoutMs });

  console.log(`CopHarness CLI — provider: ${provider}, model: ${model}`);
  console.log('Type your message and press Enter. Type "exit" or "quit" to quit.\n');

  const messages: LLMMessage[] = [];
  if (SYSTEM_PROMPT) {
    messages.push({ role: 'system', content: SYSTEM_PROMPT });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const ask = () => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        ask();
        return;
      }
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('Goodbye!');
        rl.close();
        if (adapter.destroy) await adapter.destroy();
        process.exit(0);
      }

      messages.push({ role: 'user', content: trimmed });

      try {
        process.stdout.write('Assistant: ');
        const resp = await adapter.complete({ messages, timeoutMs });
        console.log(resp.content);
        console.log();
        messages.push({ role: 'assistant', content: resp.content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}\n`);
        // Remove the failed user message so the conversation stays consistent
        messages.pop();
      }

      ask();
    });
  };

  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });

  ask();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
