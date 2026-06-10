import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetTaskLedgerForTests,
  startTask,
  getTask,
} from '../../lib/tasks/ledger';
import {
  registerTaskAbortController,
  unregisterTaskAbortController,
  requestTaskCancellation,
  _resetTaskCancellationForTests,
} from '../../lib/tasks/cancellation';

describe('taskCancellation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-cancel-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    _resetTaskCancellationForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    _resetTaskCancellationForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns not_found for unknown task id', async () => {
    const result = await requestTaskCancellation('task_nonexistent');
    expect(result).toBe('not_found');
  });

  it('returns not_running for a finished task', async () => {
    const task = await startTask({ kind: 'agent' });
    // Simulate it having been finished externally — we'll do it via finishTask
    const { finishTask } = await import('../../lib/tasks/ledger');
    await finishTask(task.id, 'succeeded');

    const result = await requestTaskCancellation(task.id);
    expect(result).toBe('not_running');
  });

  it('returns marked and cancels a running task with no registered controller', async () => {
    const task = await startTask({ kind: 'agent', title: 'slow job' });

    const result = await requestTaskCancellation(task.id);
    expect(result).toBe('marked');

    const updated = getTask(task.id);
    expect(updated?.status).toBe('cancelled');
    expect(updated?.metadata?.stopRequested).toBe(true);
    expect(typeof updated?.metadata?.stopRequestedAt).toBe('string');
  });

  it('aborts a registered controller and cancels the task', async () => {
    const task = await startTask({ kind: 'agent', title: 'abortable job' });

    let abortSignalFired = false;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => { abortSignalFired = true; });

    registerTaskAbortController(task.id, controller);
    expect(controller.signal.aborted).toBe(false);

    const result = await requestTaskCancellation(task.id);
    expect(result).toBe('aborted');
    expect(abortSignalFired).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    const updated = getTask(task.id);
    expect(updated?.status).toBe('cancelled');
  });

  it('unregisters controller after abort so a second call returns not_running', async () => {
    const task = await startTask({ kind: 'agent' });
    const controller = new AbortController();
    registerTaskAbortController(task.id, controller);

    await requestTaskCancellation(task.id);
    // Second call — task is now cancelled, controller unregistered
    const result2 = await requestTaskCancellation(task.id);
    expect(result2).toBe('not_running');
  });

  it('unregisterTaskAbortController removes the controller without aborting', () => {
    const controller = new AbortController();
    registerTaskAbortController('task_xyz', controller);
    unregisterTaskAbortController('task_xyz');
    expect(controller.signal.aborted).toBe(false);
  });
});
