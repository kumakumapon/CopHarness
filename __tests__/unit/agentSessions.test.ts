import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { acquireAgentSession, loadAgentSession, newAgentSessionId, runAgentSession } from '../../lib/agents/sessions';
import type { LLMAdapter, LLMRequest } from '../../lib/adapter';
import type { SkillDefinition } from '../../lib/skill';

let dir: string;
const originalDir = process.env.DATA_DIR;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-session-')); process.env.DATA_DIR = dir; _resetDataDirCache(); });
afterEach(() => { if (originalDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDir; _resetDataDirCache(); fs.rmSync(dir, { recursive: true, force: true }); });
const adapter = (complete: LLMAdapter['complete']): LLMAdapter => ({ provider: 'mock', model: 'mock', complete });
const call = (r: LLMRequest, name: string, args = {}) => r.skills!.find(s => s.name === name)!.handler(args);

it('persists questions and resumes the same session with an answer after reload', async () => {
  const id = newAgentSessionId();
  const first = await runAgentSession({ goal: 'save a file', sessionId: id, owner: 'cli', adapter: adapter(async r => {
    await call(r, 'requestUserInput', { question: 'Which file?' });
    await call(r, 'markComplete', { summary: 'must not succeed while waiting' });
    return { content: '' };
  }) });
  expect(first.stopReason).toBe('waiting_input');
  expect(loadAgentSession(id)?.pendingQuestion).toBe('Which file?');
  const resumed = await runAgentSession({ goal: '', sessionId: id, owner: 'cli', resume: true, answer: 'report.txt', adapter: adapter(async r => {
    expect(r.messages.some(m => m.content.includes('report.txt'))).toBe(true);
    await call(r, 'markComplete', { summary: 'done' }); return { content: 'done' };
  }) });
  expect(resumed.stopReason).toBe('succeeded');
  expect(resumed.iterations).toBe(1);
  expect(loadAgentSession(id)?.goal).toBe('save a file');
});

it('reuses a completed side effect even with reordered argument keys', async () => {
  const id = newAgentSessionId();
  const handler = jest.fn(async () => ({ content: 'notification delivered' }));
  const skill: SkillDefinition = { name: 'notify', description: 'notify', parameters: { type: 'object', properties: {} }, riskLevel: 'high', handler };
  await runAgentSession({ goal: 'notify', sessionId: id, owner: 'cli', skills: [skill], adapter: adapter(async r => {
    await call(r, 'notify', { a: 1, b: 2 }); throw new Error('provider disconnected after tool');
  }) });
  expect(loadAgentSession(id)?.status).toBe('failed');
  await runAgentSession({ goal: '', sessionId: id, owner: 'cli', skills: [skill], resume: true, adapter: adapter(async r => {
    const result = await call(r, 'notify', { b: 2, a: 1 });
    expect(result.content).toBe('notification delivered');
    await call(r, 'markComplete', { summary: 'done' }); return { content: 'done' };
  }) });
  expect(handler).toHaveBeenCalledTimes(1);
});

it('blocks uncertain side effects, wrong owners and path traversal', async () => {
  const id = newAgentSessionId();
  const handler = jest.fn(async () => { throw new Error('connection lost during notification'); });
  const skill: SkillDefinition = { name: 'notify', description: '', parameters: { type: 'object', properties: {} }, riskLevel: 'high', handler };
  await runAgentSession({ goal: 'notify', sessionId: id, owner: 'cli', skills: [skill], maxIterations: 1, adapter: adapter(async r => {
    await call(r, 'notify'); return { content: 'uncertain' };
  }) });
  const options = { goal: '', sessionId: id, owner: 'cli', resume: true, adapter: adapter(jest.fn()) };
  await expect(runAgentSession(options)).rejects.toThrow('uncertain outcome');
  await expect(runAgentSession({ ...options, owner: 'other' })).rejects.toThrow('Session not found');
  expect(() => loadAgentSession('../escape')).toThrow('Invalid session ID');
  const checkpoint = loadAgentSession(id)!;
  checkpoint.tools[0].state = 'started'; checkpoint.tools[0].result = undefined;
  fs.writeFileSync(path.join(dir, 'agent-sessions', id + '.json'), JSON.stringify(checkpoint));
  await expect(runAgentSession(options)).rejects.toThrow('uncertain outcome');
  expect(handler).toHaveBeenCalledTimes(1);
});

it('excludes concurrent execution with a durable lease', () => {
  const id = newAgentSessionId(); const release = acquireAgentSession(id);
  expect(() => acquireAgentSession(id)).toThrow('locked'); release();
  const releaseAgain = acquireAgentSession(id); releaseAgain();
});

it('does not execute a side effect if its intent cannot be saved', async () => {
  const id = newAgentSessionId();
  const handler = jest.fn(async () => ({ content: 'sent' }));
  const skill: SkillDefinition = { name: 'notify', description: '', parameters: { type: 'object', properties: {} }, riskLevel: 'high', handler };
  await expect(runAgentSession({ goal: 'notify', sessionId: id, owner: 'cli', skills: [skill], maxIterations: 1, adapter: adapter(async r => {
    // Simulate storage becoming unusable after the initial checkpoint.
    const file = path.join(dir, 'agent-sessions', id + '.json');
    fs.renameSync(file, file + '.backup');
    fs.mkdirSync(file);
    await call(r, 'notify'); return { content: '' };
  }) })).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
});
