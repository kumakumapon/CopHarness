import { error, parseImages, readJson, respondWithTurn, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/** Send a message to an existing session. Streams events (SSE) unless `stream: false`. */
export const POST = route<{ id: string }>(async (req, { runtime, params }) => {
  if (!runtime.exists(params.id)) return error('セッションが見つかりません', 404);
  const body = await readJson<{ message?: unknown; images?: unknown; stream?: unknown }>(req);
  if (typeof body.message !== 'string' || !body.message.trim()) return error('message は必須です', 400);
  const images = parseImages(body.images);
  const text = body.message;
  return respondWithTurn(params.id, onEvent => runtime.send(params.id, text, { images, onEvent }), body.stream !== false);
}, { rateLimit: true });
