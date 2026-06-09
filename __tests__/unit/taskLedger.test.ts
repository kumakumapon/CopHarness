import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetTaskLedgerForTests,
  finishTask,
  getTask,
  listTasks,
  queryTasks,
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

  it('filters tasks by status, kind, person, channel, and updated date', async () => {
    const apiTask = await startTask({ id: 'api-task', kind: 'api', personId: 'person_ada', channelKey: 'api:ada' });
    await finishTask(apiTask.id, 'succeeded');
    const scheduleTask = await startTask({ id: 'schedule-task', kind: 'schedule', personId: 'person_bob', channelKey: 'discord-channel:general' });

    expect(queryTasks({ status: 'running' }).tasks.map((task) => task.id)).toEqual([scheduleTask.id]);
    expect(queryTasks({ kindQuery: 'api', personQuery: 'ada', channelQuery: 'api:' }).tasks.map((task) => task.id)).toEqual([apiTask.id]);
    expect(queryTasks({ from: new Date('2999-01-01T00:00:00Z') })).toMatchObject({ tasks: [], total: 0 });
  });
});
