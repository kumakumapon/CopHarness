import { PERMISSION_MODES, type PermissionMode } from '../../../../lib/config';
import { error, json, readJson, route } from '../../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async (_req, { runtime, params }) => {
  const session = runtime.getSession(params.id);
  return session ? json(session) : error('セッションが見つかりません', 404);
});

/** Change the model or permission mode of a session. */
export const PATCH = route<{ id: string }>(async (req, { runtime, params }) => {
  if (!runtime.exists(params.id)) return error('セッションが見つかりません', 404);
  const body = await readJson<{ model?: unknown; mode?: unknown }>(req);
  if (typeof body.model === 'string') await runtime.setModel(params.id, body.model);
  if (body.mode !== undefined) {
    if (!PERMISSION_MODES.includes(body.mode as PermissionMode)) return error(`mode は ${PERMISSION_MODES.join(' / ')} のいずれかです`, 400);
    await runtime.setPermissionMode(params.id, body.mode as PermissionMode);
  }
  return json(runtime.getSession(params.id));
});

export const DELETE = route<{ id: string }>(async (_req, { runtime, params }) => {
  return (await runtime.deleteSession(params.id)) ? json({ ok: true }) : error('セッションが見つかりません', 404);
});
