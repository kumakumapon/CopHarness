import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { POST as chat } from '../../app/api/copilot/route';
import { POST as stream } from '../../app/api/copilot/stream/route';
import { POST as agent } from '../../app/api/copilot/agent/route';
import { createAdapterWithFallback } from '../../lib/adapterFactory';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import type { LLMRequest } from '../../lib/adapter';
jest.mock('../../lib/adapterFactory', () => ({ ...jest.requireActual('../../lib/adapterFactory'), createAdapterWithFallback: jest.fn() }));
jest.mock('../../lib/skills/index', () => ({}));
jest.mock('../../lib/identity/store', () => ({ resolveConversationKey: async () => ({ personId: 'test', channelKey: 'test', conversationKey: 'test' }) }));
jest.mock('../../lib/tasks/ledger', () => ({ startTask: async (value: { id?: string }) => ({ id: value.id ?? 'test' }), finishTask: jest.fn(), updateTaskMetadata: jest.fn() }));
jest.mock('../../lib/logs/auditLogger', () => ({ auditRequest: jest.fn(), auditResponse: jest.fn(), auditError: jest.fn() }));
jest.mock('../../lib/rateLimit', () => ({ defaultRateLimiter: { consume: () => ({ allowed: true }) }, resolveRateLimitKey: () => 'test' }));
const originalEnv = process.env;
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-entry-'));
  process.env = { NODE_ENV: 'test', PATH: originalEnv.PATH, DATA_DIR: dir };
  _resetDataDirCache();
  (createAdapterWithFallback as jest.Mock).mockImplementation(config => ({ ...config, complete: async (r: LLMRequest) => {
    const complete = r.skills?.find(s => s.name === 'markComplete');
    if (complete) await complete.handler({ summary: 'done' });
    return { content: 'ok' };
  } }));
});
afterEach(() => { process.env = originalEnv; _resetDataDirCache(); fs.rmSync(dir, { recursive: true, force: true }); jest.clearAllMocks(); });
const entries = [ ['chat', chat], ['stream', stream], ['agent', agent] ] as const;
describe.each(entries)('%s provider configuration', (_name, post) => {
  it.each([
    [{ GEMINI_API_KEY: 'gemini-only' }, 'antigravity', 'gemini-only'],
    [{ COPILOT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'anthropic-key', OPENAI_API_KEY: 'unrelated-key' }, 'anthropic', 'anthropic-key'],
    [{ COPILOT_PROVIDER: 'lmstudio' }, 'lmstudio', undefined],
  ] as const)('resolves %j', async (env, provider, apiKey) => {
    Object.assign(process.env, env);
    const response = await post(new NextRequest('http://localhost/api/copilot', { method: 'POST', body: JSON.stringify({ goal: 'test', messages: [{ role: 'user', content: 'test' }] }) }));
    expect(response.status).toBe(200); await response.text();
    expect(createAdapterWithFallback).toHaveBeenCalledWith(expect.objectContaining({ provider, apiKey }));
  });
});
