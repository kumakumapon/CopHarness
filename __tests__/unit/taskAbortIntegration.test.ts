/**
 * Tests for AbortController integration of chat / agent / scheduler tasks.
 *
 * Verifies that in-flight LLM calls register a task-scoped AbortController so
 * that requestTaskCancellation (chat "stop <id>") aborts them immediately and
 * the ledger records the task as cancelled instead of failed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { _resetTaskLedgerForTests, getTask, listTasks } from '../../lib/tasks/ledger';
import {
  _resetTaskCancellationForTests,
  hasTaskAbortController,
  isAbortError,
  requestTaskCancellation,
} from '../../lib/tasks/cancellation';

jest.mock('../../lib/adapterFactory', () => ({
  createAdapter: jest.fn(),
  resolveProvider: jest.fn(),
  resolveModel: jest.fn(),
}));

import * as adapterFactory from '../../lib/adapterFactory';
import type { LLMAdapter, LLMRequest } from '../../lib/adapter';
import { runAgentTask } from '../../lib/agents/orchestrator';
import { runPrompt } from '../../lib/scheduler/engine';

const mockComplete = jest.fn();
const mockDestroy = jest.fn();

function installMockAdapter() {
  mockComplete.mockReset();
  mockDestroy.mockReset();
  (adapterFactory.resolveProvider as jest.Mock).mockReturnValue('openai');
  (adapterFactory.resolveModel as jest.Mock).mockReturnValue('gpt-test');
  (adapterFactory.createAdapter as jest.Mock).mockReturnValue({
    provider: 'openai',
    model: 'gpt-test',
    complete: mockComplete,
    destroy: mockDestroy,
  } as unknown as LLMAdapter);
}

function abortError(): Error {
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

/** Adapter completion that never resolves until its abortSignal fires. */
function hangUntilAborted(req: LLMRequest): Promise<never> {
  return new Promise((_, reject) => {
    if (req.abortSignal?.aborted) {
      reject(abortError());
      return;
    }
    req.abortSignal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('task abort integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-task-abort-'));
    process.env.DATA_DIR = tmpDir;
    process.env.OPENAI_API_KEY = 'test-key';
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    _resetTaskCancellationForTests();
    installMockAdapter();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.OPENAI_API_KEY;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    _resetTaskCancellationForTests();
    jest.clearAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('isAbortError recognizes AbortError shapes', () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('aborted')).toBe(false);
  });

  it('aborts an in-flight agent task via requestTaskCancellation', async () => {
    mockComplete.mockImplementation(hangUntilAborted);

    const pending = runAgentTask({
      id: 'task_agent_abort',
      role: 'researcher',
      userPrompt: 'research something slow',
    });

    await waitFor(() => hasTaskAbortController('task_agent_abort'));
    const cancellation = await requestTaskCancellation('task_agent_abort');
    expect(cancellation).toBe('aborted');

    const result = await pending;
    expect(result.error).toBe('cancelled');
    expect(getTask('task_agent_abort')).toMatchObject({ status: 'cancelled' });
    expect(hasTaskAbortController('task_agent_abort')).toBe(false);
  });

  it('keeps failed status for non-aborted agent task errors', async () => {
    mockComplete.mockRejectedValue(new Error('provider exploded'));

    const result = await runAgentTask({
      id: 'task_agent_fail',
      role: 'researcher',
      userPrompt: 'fail please',
    });

    expect(result.error).toBe('provider exploded');
    expect(getTask('task_agent_fail')).toMatchObject({ status: 'failed' });
    expect(hasTaskAbortController('task_agent_fail')).toBe(false);
  });

  it('unregisters the controller after a successful agent task', async () => {
    mockComplete.mockResolvedValue({ content: 'done', model: 'gpt-test', provider: 'openai' });

    const result = await runAgentTask({
      id: 'task_agent_ok',
      role: 'researcher',
      userPrompt: 'quick task',
    });

    expect(result.error).toBeUndefined();
    expect(getTask('task_agent_ok')).toMatchObject({ status: 'succeeded' });
    expect(hasTaskAbortController('task_agent_ok')).toBe(false);
  });

  it('aborts an in-flight scheduled prompt via requestTaskCancellation', async () => {
    mockComplete.mockImplementation(hangUntilAborted);

    const pending = runPrompt('long running report', undefined, {
      schedule: { id: 'schedule_abort', name: 'Slow schedule' },
      reason: 'manual fire',
    });
    // Swallow here; the rejection is asserted below.
    pending.catch(() => undefined);

    await waitFor(() => {
      const running = listTasks(10).find(
        (t) => t.kind === 'schedule' && t.status === 'running',
      );
      return Boolean(running && hasTaskAbortController(running.id));
    });
    const task = listTasks(10).find((t) => t.kind === 'schedule')!;
    const cancellation = await requestTaskCancellation(task.id);
    expect(cancellation).toBe('aborted');

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getTask(task.id)).toMatchObject({ status: 'cancelled' });
    expect(hasTaskAbortController(task.id)).toBe(false);
  });

  it('still cancels scheduled prompts via the schedule-level abort signal', async () => {
    mockComplete.mockImplementation(hangUntilAborted);

    const scheduleAbort = new AbortController();
    const pending = runPrompt('stop me via schedule', scheduleAbort.signal, {
      schedule: { id: 'schedule_stop', name: 'Stoppable schedule' },
      reason: 'cron',
    });
    pending.catch(() => undefined);

    await waitFor(() => {
      const running = listTasks(10).find(
        (t) => t.kind === 'schedule' && t.status === 'running',
      );
      return Boolean(running && hasTaskAbortController(running.id));
    });
    scheduleAbort.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const task = listTasks(10).find((t) => t.kind === 'schedule')!;
    expect(getTask(task.id)).toMatchObject({ status: 'cancelled' });
    expect(hasTaskAbortController(task.id)).toBe(false);
  });
});
