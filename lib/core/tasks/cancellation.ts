const controllers = new Map<string, AbortController>();

/** Register an AbortController for a running task. */
export function registerTaskAbortController(taskId: string, controller: AbortController): void {
  controllers.set(taskId, controller);
}

/** Unregister the AbortController for a task (call after task completes). */
export function unregisterTaskAbortController(taskId: string): void {
  controllers.delete(taskId);
}

/** Whether a task currently has a registered AbortController. */
export function hasTaskAbortController(taskId: string): boolean {
  return controllers.has(taskId);
}

/** Whether an error came from an aborted request (AbortController / DOMException). */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** Test helper: clear all registered controllers. */
export function _resetTaskCancellationForTests(): void {
  controllers.clear();
}


export function getTaskAbortController(taskId: string): AbortController | undefined { return controllers.get(taskId); }
