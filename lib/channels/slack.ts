import { createHmac, timingSafeEqual } from 'node:crypto';

export type SlackEventType = 'url_verification' | 'message' | 'app_mention' | 'unsupported';

export interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
  };
}

export interface NormalizedSlackEvent {
  type: SlackEventType;
  challenge?: string;
  userId?: string;
  channelId?: string;
  threadKey?: string;
  text?: string;
  channelKey?: string;
  shouldRespond: boolean;
}

function slackChannelKey(userId: string): string {
  return `slack:${userId}`;
}

export function normalizeSlackEvent(payload: SlackEventEnvelope): NormalizedSlackEvent {
  if (payload.type === 'url_verification') {
    return { type: 'url_verification', challenge: payload.challenge, shouldRespond: true };
  }

  const event = payload.event;
  if (!event || event.bot_id) return { type: 'unsupported', shouldRespond: false };

  const isDirectMessage = event.type === 'message' && event.channel_type === 'im';
  const isMention = event.type === 'app_mention';
  if (!isDirectMessage && !isMention) return { type: 'unsupported', shouldRespond: false };

  const userId = event.user;
  const channelId = event.channel;
  const timestamp = event.thread_ts ?? event.ts;
  return {
    type: isMention ? 'app_mention' : 'message',
    userId,
    channelId,
    threadKey: channelId && timestamp ? `slack:${channelId}:${timestamp}` : undefined,
    text: event.text,
    channelKey: userId ? slackChannelKey(userId) : undefined,
    shouldRespond: Boolean(userId && channelId && event.text),
  };
}


export function validateSlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  if (!timestamp || !signature || !secret || !/^\\d+$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  const expected = 'v0=' + createHmac('sha256', secret).update('v0:' + timestamp + ':' + rawBody).digest('hex');
  const supplied = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
}
