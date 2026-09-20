import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/dashboard/tasks/[id]/route';
import { startTask, _resetTaskLedgerForTests } from '../../lib/tasks/ledger';
import { recordSkillExecution, _resetSkillExecutionLogForTests } from '../../lib/skills/executionLog';
import { createApprovalRequest, resolveApprovalRequest, cleanupOldRequests } from '../../lib/humanInLoop/store';
import { withSkillExecutionContext } from '../../lib/skills/executionContext';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

let dir: string;
const env = { ...process.env };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-detail-'));
  process.env.DATA_DIR = dir;
  delete process.env.COPHARNESS_API_KEY;
  _resetDataDirCache(); _resetTaskLedgerForTests(); _resetSkillExecutionLogForTests();
});
afterEach(() => {
  process.env = { ...env };
  _resetTaskLedgerForTests(); _resetDataDirCache();
  fs.rmSync(dir, { recursive: true, force: true });
});
const get = (id: string) => GET(new NextRequest('http://localhost/api/dashboard/tasks/' + id), { params: Promise.resolve({ id }) });

it('checks authentication before reading task data and returns 404 for missing tasks', async () => {
  process.env.COPHARNESS_API_KEY = 'test-key';
  expect((await get('missing')).status).toBe(401);
  delete process.env.COPHARNESS_API_KEY;
  expect((await get('missing')).status).toBe(404);
  expect((await get('__proto__')).status).toBe(404);
});

it('correlates pending approvals and executions exactly, redacts secrets, retains resolved approval status', async () => {
  await startTask({ id: 'task-a', kind: 'api', title: 'inspect password=hidden' });
  const approval = await withSkillExecutionContext({ taskId: 'task-a' }, async () => createApprovalRequest('writeFile', { path: 'note.md', apiKey: 'hidden' }));
  const other = await withSkillExecutionContext({ taskId: 'task-a-other' }, async () => createApprovalRequest('other', {}));
  const record = async (taskId: string, approvalId?: string) => recordSkillExecution({ taskId, approvalId,
    approvalStatus: 'approved', skillName: 'writeFile', startedAt: new Date(), finishedAt: new Date(),
    durationMs: 1, status: 'success', args: { path: 'note.md' }, resultContent: 'saved' });
  await record('task-a-other');
  let response = await get('task-a');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  let body = await response.json();
  expect(body.approvals.map((a: { id: string }) => a.id)).toEqual([approval.id]);
  expect(body.executions).toHaveLength(0);
  expect(JSON.stringify(body)).not.toContain('hidden');
  resolveApprovalRequest(approval.id, 'approved'); resolveApprovalRequest(other.id, 'rejected');
  await record('task-a', approval.id);
  cleanupOldRequests(-1);
  response = await get('task-a'); body = await response.json();
  expect(body.executions).toHaveLength(1);
  expect(body.approvals[0]).toMatchObject({ id: approval.id, status: 'approved' });
});

it('shows checkpoint corruption without hiding the task outcome', async () => {
  await startTask({ id: 'agent_broken', kind: 'agent', metadata: { sessionId: 'agent_broken' } });
  fs.mkdirSync(path.join(dir, 'agent-sessions'));
  fs.writeFileSync(path.join(dir, 'agent-sessions', 'agent_broken.json'), '{broken');
  const body = await (await get('agent_broken')).json();
  expect(body.checkpointWarning).toBeTruthy();
  expect(body.status).toBe('running');
});
