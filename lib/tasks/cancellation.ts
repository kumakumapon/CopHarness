/**
 * Task cancellation registry.
 *
 * Allows running tasks to register an AbortController so that
 * a chat-based stop command can abort them immediately, or fall back to
 * marking the task metadata with a stop request flag.
 */

import { finishTask, getTask, updateTaskMetadata } from './ledger';

const controllers = new Map<string, AbortController>();

/** Register an AbortController for a running task. */
export function registerTaskAbortController(taskId: string, controller: AbortController): void {
  controllers.set(taskId, controller);
}

/** Unregister the AbortController for a task (call after task completes). */
export function unregisterTaskAbortController(taskId: string): void {
  controllers.delete(taskId);
}

/** Test helper: clear all registered controllers. */
export function _resetTaskCancellationForTests(): void {
  controllers.clear();
}

/**
 * Request cancellation of a task.
 *
 * Returns:
 *  - 'aborted'     — controller was registered and aborted
 *  - 'marked'      — no controller but task was running; metadata updated and task cancelled
 *  - 'not_running' — task exists but is not in running state
 *  - 'not_found'   — no task with the given id
 */
export async function requestTaskCancellation(
  taskId: string,
): Promise<'aborted' | 'marked' | 'not_running' | 'not_found'> {
  const controller = controllers.get(taskId);
  if (controller) {
    controller.abort();
    controllers.delete(taskId);
    await finishTask(taskId, 'cancelled', 'cancelled via chat command');
    return 'aborted';
  }

  const task = getTask(taskId);
  if (!task) return 'not_found';
  if (task.status !== 'running') return 'not_running';

  await updateTaskMetadata(taskId, {
    stopRequested: true,
    stopRequestedAt: new Date().toISOString(),
  });
  await finishTask(taskId, 'cancelled', 'stop requested via chat command');
  return 'marked';
}
