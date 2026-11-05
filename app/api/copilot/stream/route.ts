/** v1 compatibility: `data: {"token"}` chunks, then `{"done": true, "reply"}` and `[DONE]`. */
import { compatRequest } from '../../../../lib/server/compat';
import { route, sse } from '../../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const POST = route(async (req, { runtime }) => {
  const { sessionId, text, images } = await compatRequest(runtime, req);
  return sse((send, close) => {
    runtime.send(sessionId, text, {
      interactive: false,
      images,
      onEvent: e => { if (e.type === 'text_delta' && !e.agent) send({ token: e.text }); },
    }).then(result => {
      if (result.stopReason === 'error') send({ error: result.error, taskId: sessionId });
      else send({ done: true, reply: result.text, taskId: sessionId });
      close();
    }, err => { send({ error: err instanceof Error ? err.message : String(err) }); close(); });
  }, { 'X-Session-Id': sessionId });
}, { rateLimit: true });
