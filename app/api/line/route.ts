/** LINE Messaging API webhook. Authenticated by the LINE signature, not the API token. */
import { handleLineEvents, verifyLineSignature } from '../../../lib/channels/line';
import { getRuntime } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET ?? '';
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';
  if (!secret || !token) return Response.json({ error: 'LINE is not configured' }, { status: 503 });
  const body = await req.text();
  if (!verifyLineSignature(body, req.headers.get('x-line-signature'), secret)) return Response.json({ error: 'Invalid signature' }, { status: 401 });
  let events: unknown[] = [];
  try { events = (JSON.parse(body) as { events?: unknown[] }).events ?? []; } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  handleLineEvents(getRuntime(), events as Parameters<typeof handleLineEvents>[1], token);
  return Response.json({ ok: true });
}
