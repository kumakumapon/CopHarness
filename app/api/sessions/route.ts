import { PERMISSION_MODES, type PermissionMode } from '../../../lib/config';
import { error, json, parseImages, readJson, respondWithTurn, route } from '../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (req, { runtime }) => {
  const owner = new URL(req.url).searchParams.get('owner') ?? undefined;
  return json({ sessions: runtime.listSessions({ owner }) });
});

/** Start a new session with its first message. Streams events (SSE) unless `stream: false`. */
export const POST = route(async (req, { runtime }) => {
  const body = await readJson<{ message?: unknown; images?: unknown; model?: unknown; mode?: unknown; stream?: unknown; owner?: unknown }>(req);
  if (typeof body.message !== 'string' || !body.message.trim()) return error('message は必須です', 400);
  if (body.mode !== undefined && !PERMISSION_MODES.includes(body.mode as PermissionMode)) return error(`mode は ${PERMISSION_MODES.join(' / ')} のいずれかです`, 400);
  const images = parseImages(body.images);
  const owner = typeof body.owner === 'string' && body.owner.trim() ? `api:${body.owner.trim()}` : 'web';
  const sessionId = await runtime.createSession({
    owner,
    title: body.message,
    model: typeof body.model === 'string' ? body.model : undefined,
    permissionMode: body.mode as PermissionMode | undefined,
  });
  const text = body.message;
  return respondWithTurn(sessionId, onEvent => runtime.send(sessionId, text, { images, onEvent }), body.stream !== false);
}, { rateLimit: true });
