/**
 * v1 compatibility: stateless chat. `{"messages": [{"role","content"}]}` → `{"reply"}`.
 * Each call runs as a headless session (tools that need approval are denied).
 * New integrations should use /api/sessions.
 */
import { compatRequest } from '../../../lib/server/compat';
import { json, route } from '../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const POST = route(async (req, { runtime }) => {
  const { sessionId, text, images } = await compatRequest(runtime, req);
  const result = await runtime.send(sessionId, text, { interactive: false, images });
  if (result.stopReason === 'error') return json({ error: 'LLM API error', details: result.error, sessionId }, 502);
  return json({ reply: result.text, sessionId, taskId: sessionId, usage: result.usage, stopReason: result.stopReason });
}, { rateLimit: true });
