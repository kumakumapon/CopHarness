import { getScheduler } from '../../../../../lib/scheduler';
import { error, json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/** Run a schedule now (in the background). */
export const POST = route<{ id: string }>(async (_req, { runtime, params }) => {
  const scheduler = getScheduler(runtime);
  const schedule = scheduler.store.find(params.id);
  if (!schedule) return error('スケジュールが見つかりません', 404);
  if (scheduler.isRunning(schedule.id)) return error('実行中です', 409);
  void scheduler.run(schedule.id).catch(err => console.error('[schedule]', err));
  return json({ started: true }, 202);
}, { rateLimit: true });
