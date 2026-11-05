import { runDoctor } from '../../../lib/doctor';
import { getScheduler } from '../../../lib/scheduler';
import { json, route } from '../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req, { runtime }) => {
  const [status, checks] = await Promise.all([runtime.status(), runDoctor(runtime)]);
  return json({ ...status, checks, schedules: getScheduler(runtime).store.list().length, pendingApprovals: runtime.approvals.list() });
});
