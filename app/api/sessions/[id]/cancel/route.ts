import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(async (_req, { runtime, params }) => json({ cancelled: runtime.cancel(params.id) }));
