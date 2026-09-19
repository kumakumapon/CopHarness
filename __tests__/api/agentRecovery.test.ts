import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { POST } from '../../app/api/copilot/agent/route';
import { createAdapterWithFallback } from '../../lib/adapterFactory';
import { getTask, _resetTaskLedgerForTests } from '../../lib/tasks/ledger';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import type { LLMRequest } from '../../lib/adapter';

jest.mock('../../lib/adapterFactory', () => ({
  resolveRuntimeConfig: () => ({ provider: 'mock', model: 'mock', configured: true }),
  createAdapterWithFallback: jest.fn(),
}));
jest.mock('../../lib/skills/index', () => ({}));
jest.mock('../../lib/skill', () => ({ listActiveSkills: () => [], resolveSkills: () => [] }));
jest.mock('../../lib/rateLimit', () => ({ defaultRateLimiter: { consume: () => ({ allowed: true }) }, resolveRateLimitKey: () => 'test' }));
jest.mock('../../lib/identity/store', () => ({ resolveConversationKey: async () => ({ personId: 'test', channelKey: 'api:test', conversationKey: 'test' }) }));
jest.mock('../../lib/search/index', () => ({ indexTaskRecord: jest.fn() }));
let dir: string;
const original = { data: process.env.DATA_DIR, key: process.env.COPHARNESS_API_KEY, ledger: process.env.TASK_LEDGER_FILE };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-api-')); process.env.DATA_DIR = dir;
  delete process.env.COPHARNESS_API_KEY; delete process.env.TASK_LEDGER_FILE;
  _resetDataDirCache(); _resetTaskLedgerForTests();
});
afterEach(() => {
  for (const [key, value] of Object.entries({ DATA_DIR: original.data, COPHARNESS_API_KEY: original.key, TASK_LEDGER_FILE: original.ledger })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  _resetDataDirCache(); _resetTaskLedgerForTests(); fs.rmSync(dir, { recursive: true, force: true });
});
function request(body: unknown) { return new NextRequest('http://localhost/api/copilot/agent', { method: 'POST', body: JSON.stringify(body) }); }
function mock(complete: (r: LLMRequest) => Promise<{ content: string }>) {
  (createAdapterWithFallback as jest.Mock).mockReturnValue({ provider: 'mock', model: 'mock', complete });
}
it.each(['failed', 'stalled', 'iteration_limit', 'succeeded'] as const)('records %s consistently in SSE and ledger', async reason => {
  mock(async r => {
    if (reason === 'failed') throw new Error('offline');
    if (reason === 'succeeded') await r.skills!.find(s => s.name === 'markComplete')!.handler({ summary: 'done' });
    return { content: reason === 'stalled' ? '' : 'working' };
  });
  const response = await POST(request({ goal: 'test', maxIterations: 2 }));
  const text = await response.text();
  expect(text).toContain('"stopReason":"' + reason + '"');
  expect(getTask(response.headers.get('X-Task-Id')!)?.status).toBe(reason);
});
it('answers a pending question using the same task ID', async () => {
  mock(async r => { await r.skills!.find(s => s.name === 'requestUserInput')!.handler({ question: 'where?' }); return { content: '' }; });
  const response = await POST(request({ goal: 'test', subject: 'alice' }));
  expect(await response.text()).toContain('input_required');
  const id = response.headers.get('X-Task-Id')!;
  expect(getTask(id)?.status).toBe('waiting_input');
  expect((await POST(request({ sessionId: id, subject: 'bob', answer: 'there' }))).status).toBe(404);
  expect((await POST(request({ sessionId: id, subject: 'alice' }))).status).toBe(400);
  mock(async r => {
    expect(r.messages.some(m => m.content.includes('there'))).toBe(true);
    await r.skills!.find(s => s.name === 'markComplete')!.handler({ summary: 'done' }); return { content: 'done' };
  });
  const resumed = await POST(request({ sessionId: id, subject: 'alice', answer: 'there' }));
  await resumed.text(); expect(resumed.headers.get('X-Task-Id')).toBe(id);
  expect(getTask(id)?.status).toBe('succeeded');
});
it.each([null, [], { goal: 'x', maxIterations: -1 }, { goal: 'x', maxIterations: 1.5 }, { goal: 'x', skills: [1] }])('rejects malformed request %j', async body => {
  expect((await POST(request(body))).status).toBe(400);
});

it('persists cancellation when the HTTP client disconnects', async () => {
  const abort = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  mock(async r => {
    entered();
    await new Promise<void>((_, reject) => r.abortSignal!.addEventListener('abort', () => reject(new Error('disconnected')), { once: true }));
    return { content: 'unreachable' };
  });
  const req = new NextRequest('http://localhost/api/copilot/agent', { method: 'POST', body: JSON.stringify({ goal: 'test' }), signal: abort.signal });
  const response = await POST(req);
  await started; abort.abort(); await response.text();
  expect(getTask(response.headers.get('X-Task-Id')!)?.status).toBe('cancelled');
});
