/**
 * Utility helpers for AbortSignal management.
 * Merges an internal timeout with an optional external AbortSignal so that
 * whichever fires first will cancel the operation.
 */

/**
 * Merge a timeout (in ms) with an optional external AbortSignal into a single
 * AbortSignal.  The caller **must** call `cleanup()` when the operation
 * finishes to avoid leaking the internal timeout timer.
 *
 * Falls back to setTimeout when AbortSignal.timeout is not available (older
 * Node versions).
 */
export function mergeAbortSignals(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  // Internal timeout — use setTimeout so we can cancel it on cleanup.
  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        Object.assign(new Error(`Request timed out after ${timeoutMs}ms`), {
          name: 'TimeoutError',
        }),
      );
    }
  }, timeoutMs);

  // Wire the external signal.
  if (external) {
    if (external.aborted) {
      clearTimeout(timeoutId);
      controller.abort(external.reason);
    } else {
      external.addEventListener(
        'abort',
        () => {
          if (!controller.signal.aborted) {
            controller.abort(external.reason);
          }
        },
        { once: true },
      );
    }
  }

  const cleanup = () => clearTimeout(timeoutId);
  return { signal: controller.signal, cleanup };
}
