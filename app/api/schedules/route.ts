import type { DeliveryTarget } from '../../../lib/channels/notify';
import { describeNextRun, getScheduler } from '../../../lib/scheduler';
import { error, json, readJson, route } from '../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req, { runtime }) => {
  const scheduler = getScheduler(runtime);
  const schedules = scheduler.store.list().map(s => ({ ...s, nextRunAt: s.enabled ? describeNextRun(s) : undefined, running: scheduler.isRunning(s.id) }));
  return json({ schedules });
});

export const POST = route(async (req, { runtime }) => {
  const body = await readJson<{ name?: string; cron?: string; prompt?: string; model?: string; deliver?: DeliveryTarget; enabled?: boolean }>(req);
  if (typeof body.cron !== 'string' || typeof body.prompt !== 'string') return error('cron と prompt は必須です', 400);
  if (body.deliver && !['discord', 'line', 'slack', 'webhook'].includes(body.deliver.channel)) return error('deliver.channel は discord / line / slack / webhook のいずれかです', 400);
  const schedule = getScheduler(runtime).store.add({ ...body, cron: body.cron, prompt: body.prompt, deliver: body.deliver?.to ? body.deliver : undefined });
  return json(schedule, 201);
});
