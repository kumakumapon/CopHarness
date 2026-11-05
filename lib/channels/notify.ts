/** Push a message to a chat channel or webhook (used by schedules and channel bots). */
import { safeFetch } from '../util/urlGuard';

export type DeliveryTarget =
  | { channel: 'discord'; to: string }
  | { channel: 'line'; to: string }
  | { channel: 'slack'; to: string; threadTs?: string }
  | { channel: 'webhook'; to: string };

export function splitText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim() || '（空の応答）';
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function post(url: string, body: unknown, headers: Record<string, string>, send: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<Response> {
  const res = await send(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res;
}

/** Platform ids (channels, users) are plain tokens; reject anything that could alter the request path. */
function platformId(id: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new Error(`配信先の ID の形式が正しくありません: ${id.slice(0, 40)}`);
  return encodeURIComponent(id);
}

export async function deliver(target: DeliveryTarget, text: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  switch (target.channel) {
    case 'discord': {
      const token = env.DISCORD_BOT_TOKEN;
      if (!token) throw new Error('DISCORD_BOT_TOKEN が設定されていません');
      for (const content of splitText(text, 2000)) {
        await post(`https://discord.com/api/v10/channels/${platformId(target.to)}/messages`, { content }, { Authorization: `Bot ${token}` });
      }
      return;
    }
    case 'line': {
      const token = env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
      const messages = splitText(text, 4900).slice(0, 5).map(t => ({ type: 'text', text: t }));
      await post('https://api.line.me/v2/bot/message/push', { to: target.to, messages }, { Authorization: `Bearer ${token}` });
      return;
    }
    case 'slack': {
      const token = env.SLACK_BOT_TOKEN;
      if (!token) throw new Error('SLACK_BOT_TOKEN が設定されていません');
      for (const chunk of splitText(text, 3900)) {
        const res = await post('https://slack.com/api/chat.postMessage', { channel: target.to, text: chunk, ...(target.threadTs ? { thread_ts: target.threadTs } : {}) }, { Authorization: `Bearer ${token}` });
        const json = await res.json() as { ok?: boolean; error?: string };
        if (!json.ok) throw new Error(`Slack chat.postMessage: ${json.error}`);
      }
      return;
    }
    case 'webhook':
      // `text` for Slack-style webhooks, `content` for Discord webhooks.
      // The URL is operator-configured but may point anywhere: refuse internal addresses.
      await post(target.to, { text, content: text.slice(0, 2000) }, {}, safeFetch);
      return;
  }
}
