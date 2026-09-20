import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runAgentSession, loadAgentSession } from '../../lib/agents/sessions';
import { startTask, finishTask, _resetTaskLedgerForTests } from '../../lib/tasks/ledger';
import { getTaskDetail } from '../../lib/tasks/detail';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { _resetExecutionBackendForTests } from '../../lib/execution';
import { _resetSkillExecutionLogForTests } from '../../lib/skills/executionLog';
import { withSkillExecutionContext } from '../../lib/skills/executionContext';
import { registerSkill, getSkill, type SkillDefinition } from '../../lib/skill';
import { wrapWithGate } from '../../lib/humanInLoop/gate';
import { listApprovalRequests, resolveApprovalRequest } from '../../lib/humanInLoop/store';
import { writeFile } from '../../lib/skills/writeFile';
import { readFile } from '../../lib/skills/readFile';
import { fetchUrl } from '../../lib/skills/fetchUrl';
import { safeFetch } from '../../lib/utils/urlGuard';
import type { LLMAdapter, LLMRequest } from '../../lib/adapter';

jest.mock('../../lib/utils/urlGuard', () => ({ safeFetch: jest.fn() }));
const env = { ...process.env };
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-'));
  process.env.DATA_DIR = dir; process.env.SKILL_FILE_SANDBOX_DIR = path.join(dir, 'workspace');
  process.env.EXECUTION_BACKEND = 'local';
  delete process.env.TOOL_POLICY_FILE;
  _resetDataDirCache(); _resetTaskLedgerForTests(); _resetSkillExecutionLogForTests(); _resetExecutionBackendForTests();
  for (const skill of [writeFile, readFile, fetchUrl]) registerSkill(wrapWithGate({ ...skill }));
});
afterEach(() => {
  process.env = { ...env }; _resetTaskLedgerForTests(); _resetDataDirCache(); _resetExecutionBackendForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});
const call = (r: LLMRequest, name: string, args: Record<string, unknown>) => r.skills!.find(s => s.name === name)!.handler(args);
const adapter = (complete: LLMAdapter['complete']): LLMAdapter => ({ provider: 'mock', model: 'tutorial', complete });
async function run(id: string, complete: LLMAdapter['complete'], skills: SkillDefinition[], resume = false) {
  await startTask({ id, kind: 'agent', metadata: { sessionId: id } });
  const result = await withSkillExecutionContext({ taskId: id }, () => runAgentSession({
    sessionId: id, owner: 'cli', goal: 'tutorial goal', adapter: adapter(complete), skills, resume,
  }));
  await finishTask(id, result.stopReason, result.error);
  return result;
}

it('researches a fixture, saves an actual artifact and resumes without appending it twice', async () => {
  jest.mocked(safeFetch).mockResolvedValue(new Response('<h1>Reference</h1><p>Verified fact</p>', { headers: { 'Content-Type': 'text/html' } }));
  const skills = ['fetchUrl', 'writeFile', 'readFile'].map(n => getSkill(n)!);
  const args = { path: 'reports/research.md', content: 'Verified fact\nSource: https://example.com/reference\n', append: true };
  await run('agent_research', async r => {
    expect((await call(r, 'fetchUrl', { url: 'https://example.com/reference' })).content).toContain('Verified fact');
    expect((await call(r, 'writeFile', args)).isError).toBeFalsy();
    throw new Error('disconnect after save');
  }, skills);
  expect(loadAgentSession('agent_research')?.status).toBe('failed');
  await run('agent_research', async r => {
    await call(r, 'writeFile', args);
    const saved = await call(r, 'readFile', { path: args.path });
    expect(saved.content).toContain('Verified fact');
    await call(r, 'markComplete', { summary: 'Saved reports/research.md' });
    return { content: 'reports/research.md' };
  }, skills, true);
  expect(fs.readFileSync(path.join(dir, 'workspace', args.path), 'utf8')).toBe(args.content);
  const detail = getTaskDetail('agent_research')!;
  expect(detail.stopReason).toBe('succeeded');
  expect(detail.output).toBe('reports/research.md');
  expect(detail.tools.filter(t => t.name === 'writeFile')).toHaveLength(1);
});

it.each(['approved', 'rejected'] as const)('requires approval for a file change and records %s with its task', async status => {
  fs.writeFileSync(path.join(dir, 'policy.json'), JSON.stringify({ version: 1, rules: [
    { id: 'review-writes', skills: ['writeFile'], approvalMode: 'requireApproval' },
  ] }));
  fs.mkdirSync(path.join(dir, 'workspace'));
  fs.writeFileSync(path.join(dir, 'workspace', 'note.md'), 'before\n');
  const id = 'agent_' + status;
  const execution = run(id, async r => {
    const result = await call(r, 'writeFile', { path: 'note.md', content: 'after\n' });
    if (!result.isError) await call(r, 'readFile', { path: 'note.md' });
    await call(r, result.isError ? 'markFailed' : 'markComplete', { summary: status });
    return { content: result.content };
  }, ['writeFile', 'readFile'].map(n => getSkill(n)!));
  let approval;
  for (let i = 0; i < 100 && !approval; i++) {
    approval = listApprovalRequests('pending').find(a => a.taskId === id);
    if (!approval) await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(approval).toBeDefined();
  expect(approval!.preview?.diff).toContain('-before');
  expect(approval!.preview?.diff).toContain('+after');
  expect(fs.readFileSync(path.join(dir, 'workspace', 'note.md'), 'utf8')).toBe('before\n');
  expect(getTaskDetail(id)!.approvals[0].status).toBe('pending');
  resolveApprovalRequest(approval!.id, status);
  const result = await execution;
  expect(result.stopReason).toBe(status === 'approved' ? 'succeeded' : 'failed');
  expect(fs.readFileSync(path.join(dir, 'workspace', 'note.md'), 'utf8')).toBe(status === 'approved' ? 'after\n' : 'before\n');
  const detail = getTaskDetail(id)!;
  expect(detail.approvals[0].status).toBe(status);
  expect(detail.executions.find(e => e.skillName === 'writeFile')?.approvalStatus).toBe(status);
  expect(detail.executions.find(e => e.skillName === 'readFile')?.approvalId).toBeUndefined();
});
