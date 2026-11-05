/** Slack Events API endpoint. Authenticated by the Slack signing secret, not the API token. */
import { handleSlackEvent, verifySlackSignature, type SlackEnvelope } from '../../../lib/channels/slack';
import { getRuntime } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET ?? '';
  if (!secret || !process.env.SLACK_BOT_TOKEN) return Response.json({ error: 'Slack is not configured' }, { status: 503 });
  const body = await req.text();
  if (!verifySlackSignature(body, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'), secret)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }
  let envelope: SlackEnvelope;
  try { envelope = JSON.parse(body) as SlackEnvelope; } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (envelope.type === 'url_verification') return Response.json({ challenge: envelope.challenge ?? '' });
  // Slack retries when we are slow; the first delivery is already being handled.
  if (!req.headers.get('x-slack-retry-num') && envelope.type === 'event_callback') handleSlackEvent(getRuntime(), envelope);
  return Response.json({ ok: true });
}
