import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import type { LLMRequest } from '../../lib/core/adapter';

const mockComplete = jest.fn(async (request: LLMRequest) => {
  await request.skills?.find(s => s.name === 'markComplete')?.handler({ summary: 'done' });
  return { content: 'ok' };
});
jest.mock('../../lib/core/adapterFactory', () => ({
  ...jest.requireActual('../../lib/core/adapterFactory'),
  createAdapterWithFallback: () => ({ provider: 'mock', model: 'mock', complete: mockComplete, stream: async function* () { yield 'ok'; } }),
}));
jest.mock('../../lib/runtime/fullBootstrap', () => { throw new Error('Full bootstrap must not load'); });

const savedEnv = process.env;
let temp: string;
beforeEach(() => {
  jest.resetModules();
  mockComplete.mockClear();
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-api-'));
  process.env = { ...savedEnv, COPHARNESS_PROFILE: 'minimal', COPILOT_PROVIDER: 'openai', OPENAI_API_KEY: 'test',
    COPHARNESS_API_KEY: 'test-api', DATA_DIR: path.join(temp, 'unused'), TRANSCRIPT_LOGGING: 'true', COMPACTOR_TOKEN_THRESHOLD: '1' };
  delete process.env.ENABLED_SKILLS;
});
afterEach(() => { process.env = savedEnv; fs.rmSync(temp, { recursive: true, force: true }); });

function request(route: string, body: unknown, authenticated = true) {
  return new NextRequest(`http://localhost${route}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-api' } : {}),
  }, body: JSON.stringify(body) });
}

it('serves chat with no implicit tools, compaction calls or persistence', async () => {
  const { POST } = require('../../app/api/copilot/route') as typeof import('../../app/api/copilot/route');
  const response = await POST(request('/api/copilot', { messages: [{ role: 'user', content: 'A long prompt exceeding the compaction threshold' }] }));
  expect(response.status).toBe(200);
  expect((await response.json()).reply).toBe('ok');
  expect(mockComplete).toHaveBeenCalledTimes(1);
  expect(mockComplete.mock.calls[0][0].skills).toEqual([]);
  expect(fs.existsSync(process.env.DATA_DIR!)).toBe(false);
});

it('retains API authentication and input validation', async () => {
  const { POST } = require('../../app/api/copilot/route') as typeof import('../../app/api/copilot/route');
  expect((await POST(request('/api/copilot', {}, false))).status).toBe(401);
  expect((await POST(request('/api/copilot', {}))).status).toBe(400);
  expect(mockComplete).not.toHaveBeenCalled();
});

it('streams chat and executes a single agent without creating sessions', async () => {
  const chat = require('../../app/api/copilot/stream/route') as typeof import('../../app/api/copilot/stream/route');
  const response = await chat.POST(request('/api/copilot/stream', { messages: [{ role: 'user', content: 'hello' }] }));
  expect(await response.text()).toContain('[DONE]');
  const agent = require('../../app/api/copilot/agent/route') as typeof import('../../app/api/copilot/agent/route');
  const run = await agent.POST(request('/api/copilot/agent', { goal: 'finish' }));
  expect(await run.text()).toContain('"stopReason":"succeeded"');
  const resume = await agent.POST(request('/api/copilot/agent', { sessionId: 'old' }));
  expect(resume.status).toBe(400);
  expect(fs.existsSync(process.env.DATA_DIR!)).toBe(false);
});
