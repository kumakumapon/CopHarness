import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetTaskLedgerForTests,
  finishTask,
  getTask,
  listTasks,
  startTask,
} from '../../lib/tasks/ledger';

describe('task ledger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-task-ledger-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts and finishes an automatically identified task', async () => {
    const task = await startTask({
      kind: 'conversation',
      personId: 'person_123',
      channelKey: 'line:user-1',
      conversationKey: 'person:person_123',
      title: 'hello world',
    });

    expect(task.id).toMatch(/^task_/);
    expect(task.status).toBe('running');

    await finishTask(task.id, 'succeeded');

    expect(getTask(task.id)).toMatchObject({
      id: task.id,
      kind: 'conversation',
      personId: 'person_123',
      channelKey: 'line:user-1',
      conversationKey: 'person:person_123',
      status: 'succeeded',
    });
  });

  it('can adopt caller-provided task ids while still recording failures', async () => {
    const task = await startTask({ id: 'external-task-1', kind: 'api' });
    await finishTask(task.id, 'failed', new Error('boom'));

    expect(listTasks(10)[0]).toMatchObject({
      id: 'external-task-1',
      kind: 'api',
      status: 'failed',
      errorPreview: 'boom',
    });
  });
});
