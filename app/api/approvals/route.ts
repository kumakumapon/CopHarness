import { json, route } from '../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req, { runtime }) => json({ approvals: runtime.approvals.list() }));
