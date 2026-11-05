import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, type Config } from '../lib/config';
import type { ModelProvider, ModelRequest, ModelResult } from '../lib/providers';
import { McpManager } from '../lib/mcp';
import { Runtime } from '../lib/runtime';
import type { ContentPart, Message } from '../lib/types';

export function tempDir(prefix = 'copharness-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function testConfig(overrides: Partial<Config> = {}, env: Record<string, string> = {}): Config {
  const cwd = tempDir();
  const { config } = loadConfig({ cwd, env: { OPENAI_API_KEY: 'test-key', ...env } });
  return { ...config, model: 'openai/test-model', ...overrides };
}

export type Step = (request: ModelRequest) => Partial<ModelResult> & { content?: ContentPart[] };

/** A provider that replays scripted responses and records every request. */
export class ScriptedProvider implements ModelProvider {
  readonly kind = 'openai';
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: Step[]) {}

  async stream(request: ModelRequest, onEvent: Parameters<ModelProvider['stream']>[1]): Promise<ModelResult> {
    this.requests.push({ ...request, messages: request.messages.map(m => structuredClone(m)) });
    const step = this.steps.shift();
    if (!step) throw new Error('ScriptedProvider: no more steps');
    const out = step(request);
    const content = out.content ?? out.message?.content ?? [];
    for (const p of content) if (p.type === 'text') onEvent({ type: 'text_delta', text: p.text });
    const hasCalls = content.some(p => p.type === 'tool_call');
    return {
      message: out.message ?? ({ role: 'assistant', content } as Message),
      stopReason: out.stopReason ?? (hasCalls ? 'tool_use' : 'end_turn'),
      usage: out.usage ?? { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

export const text = (t: string): Step => () => ({ content: [{ type: 'text', text: t }] });
export const call = (name: string, input: Record<string, unknown>, id = `call_${name}`): Step =>
  () => ({ content: [{ type: 'tool_call', id, name, input }] });

export function testRuntime(provider: ModelProvider, overrides: Partial<Config> = {}): Runtime {
  const config = testConfig(overrides);
  const runtime = new Runtime(config, { mcp: new McpManager({}) });
  runtime.provider = () => provider;
  return runtime;
}
