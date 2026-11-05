import { error, route, sse } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/**
 * Attach to the turn that is currently running (after a reload or from a
 * second client). Replays the events so far (unless `?replay=0`), then streams
 * until the turn ends.
 */
export const GET = route<{ id: string }>(async (req, { runtime, params }) => {
  const replay = new URL(req.url).searchParams.get('replay') !== '0';
  if (!runtime.exists(params.id)) return error('セッションが見つかりません', 404);
  return sse((send, close) => {
    if (!runtime.isRunning(params.id)) {
      send({ type: 'idle' });
      close();
      return;
    }
    const unsubscribe = runtime.subscribe(params.id, event => {
      send(event);
      if (event.type === 'turn_end') queueMicrotask(close);
    }, { replay });
    return unsubscribe;
  });
});
