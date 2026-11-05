import { error, json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(async (_req, { runtime, params }) => {
  if (!runtime.exists(params.id)) return error('セッションが見つかりません', 404);
  return json(await runtime.compact(params.id));
}, { rateLimit: true });
