import type { Schedule } from '../../../../lib/scheduler';
import { getScheduler } from '../../../../lib/scheduler';
import { error, json, readJson, route } from '../../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(async (req, { runtime, params }) => {
  const body = await readJson<Partial<Schedule>>(req);
  const patch: Partial<Schedule> = {};
  for (const key of ['name', 'cron', 'prompt', 'enabled', 'model', 'deliver'] as const) {
    if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
  }
  const updated = getScheduler(runtime).store.update(params.id, patch);
  return updated ? json(updated) : error('スケジュールが見つかりません', 404);
});

export const DELETE = route<{ id: string }>(async (_req, { runtime, params }) => {
  return getScheduler(runtime).store.remove(params.id) ? json({ ok: true }) : error('スケジュールが見つかりません', 404);
});
