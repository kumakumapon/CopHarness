/** Slack Events API handling: signature check, DMs and @mentions answered in-thread. */
import { createHmac } from 'node:crypto';
import type { Runtime } from '../runtime';
import { tokensEqual } from '../server/auth';
import { getGateway, RecentIds } from './gateway';
import { deliver } from './notify';

export function verifySlackSignature(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  return tokensEqual(signature, expected);
}

export interface SlackEnvelope {
  type: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
}

const recent = new RecentIds();

export function handleSlackEvent(runtime: Runtime, envelope: SlackEnvelope): void {
  const e = envelope.event;
  if (!e || e.bot_id || e.subtype || !e.user || !e.channel || !e.ts) return;
  const isDm = e.type === 'message' && e.channel_type === 'im';
  if (e.type !== 'app_mention' && !isDm) return;
  if (recent.seen(envelope.event_id)) return;
  const thread = e.thread_ts ?? e.ts;
  const text = (e.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
  void getGateway(runtime).handle({
    channel: 'slack',
    userId: e.user,
    conversationKey: `slack:${e.channel}:${thread}`,
    owner: isDm ? `slack:${e.user}` : `slack-channel:${e.channel}`,
    text,
  }, {
    send: reply => deliver({ channel: 'slack', to: e.channel!, threadTs: thread }, reply),
  }).catch(err => console.error('[slack]', err));
}
