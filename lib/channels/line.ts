/** LINE Messaging API webhook handling (signature check, replies, pushes). */
import { createHmac } from 'node:crypto';
import type { Runtime } from '../runtime';
import type { ImagePart } from '../types';
import { tokensEqual } from '../server/auth';
import { getGateway, RecentIds } from './gateway';
import { splitText } from './notify';

export function verifyLineSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  return tokensEqual(signature, expected);
}

interface LineEvent {
  type: string;
  replyToken?: string;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  source?: { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string };
  message?: { id: string; type: string; text?: string };
}

const recent = new RecentIds();
const REPLY_TOKEN_TTL_MS = 50_000;

async function lineApi(path: string, body: unknown, token: string): Promise<void> {
  const res = await fetch(`https://api.line.me/v2/bot/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function fetchImage(messageId: string, token: string): Promise<ImagePart | undefined> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return undefined;
  const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
  return { type: 'image', mimeType, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

/** Process webhook events in the background (LINE expects a fast 200). */
export function handleLineEvents(runtime: Runtime, events: LineEvent[], token: string): void {
  const gateway = getGateway(runtime);
  for (const event of events) {
    if (event.type !== 'message' || !event.message || !event.source) continue;
    if (event.deliveryContext?.isRedelivery || recent.seen(event.webhookEventId)) continue;
    const { source, message } = event;
    if (message.type !== 'text' && message.type !== 'image') continue;
    const target = source.groupId ?? source.roomId ?? source.userId;
    if (!target || !source.userId) continue;
    const receivedAt = Date.now();
    let replyToken = event.replyToken;

    void (async () => {
      const images = message.type === 'image' ? [await fetchImage(message.id, token)].filter((x): x is ImagePart => Boolean(x)) : [];
      const group = source.type !== 'user';
      await gateway.handle({
        channel: 'line',
        userId: source.userId!,
        conversationKey: group ? `line:${source.type}:${target}` : `line:${source.userId}`,
        owner: group ? `line-${source.type}:${target}` : `line:${source.userId}`,
        text: message.text ?? '',
        images,
      }, {
        // The free reply token is used once while it is valid; later messages are pushed.
        send: async text => {
          const messages = splitText(text, 4900).slice(0, 5).map(t => ({ type: 'text', text: t }));
          if (replyToken && Date.now() - receivedAt < REPLY_TOKEN_TTL_MS) {
            const tokenNow = replyToken;
            replyToken = undefined;
            try { return await lineApi('message/reply', { replyToken: tokenNow, messages }, token); } catch { /* fall back to push */ }
          }
          await lineApi('message/push', { to: target, messages }, token);
        },
      });
    })().catch(err => console.error('[line]', err));
  }
}
