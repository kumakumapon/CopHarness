/**
 * One gateway for every chat channel (Discord, LINE, Slack). A channel adapter
 * turns a platform message into an IncomingMessage and provides `send`; the
 * gateway handles commands, sessions, approvals and replies the same way for
 * all of them.
 *
 * Chat commands: /help /new /stop /status /approve <id> /deny <id>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Runtime } from '../runtime';
import type { AgentEvent, ImagePart } from '../types';
import { atomicWriteJsonSync, withFileLockSync } from '../util/jsonFile';

export interface IncomingMessage {
  channel: 'discord' | 'line' | 'slack';
  /** Platform user id of the sender. */
  userId: string;
  /** Conversation the reply belongs to: a DM, a channel or a thread. */
  conversationKey: string;
  /** Memory scope / session owner. DMs: the user; group chats: the conversation. */
  owner: string;
  text: string;
  images?: ImagePart[];
}

export interface ChannelReply {
  send(text: string): Promise<void>;
  /** Called while a turn runs (e.g. Discord's typing indicator). */
  typing?(): void;
}

const HELP = [
  'CopHarness の使い方:',
  '・メッセージを送ると AI が答えます（必要に応じてツールを使います）',
  '/new — 新しい会話を始める',
  '/stop — 実行中の処理を止める',
  '/status — 現在の会話とモデル',
  '/approve <ID> ・ /deny <ID> — ツール実行の承認・拒否（承認者のみ）',
].join('\n');

export class ChannelGateway {
  private readonly file: string;

  constructor(private readonly runtime: Runtime) {
    this.file = path.join(runtime.config.dataDir, 'channels.json');
  }

  userKey(msg: Pick<IncomingMessage, 'channel' | 'userId'>): string {
    return `${msg.channel}:${msg.userId}`;
  }

  isAllowed(msg: Pick<IncomingMessage, 'channel' | 'userId'>): boolean {
    const allowed = this.runtime.config.channels.allowedUsers;
    return !allowed || allowed.includes(this.userKey(msg));
  }

  isApprover(msg: Pick<IncomingMessage, 'channel' | 'userId'>): boolean {
    return this.runtime.config.channels.approvers.includes(this.userKey(msg));
  }

  private readMap(): Record<string, string> {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, string>; } catch { return {}; }
  }

  private writeMap(update: (map: Record<string, string>) => void): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    withFileLockSync(this.file, () => {
      const map = this.readMap();
      update(map);
      atomicWriteJsonSync(this.file, map);
    });
  }

  sessionFor(conversationKey: string): string | undefined {
    const id = this.readMap()[conversationKey];
    return id && this.runtime.exists(id) ? id : undefined;
  }

  async handle(msg: IncomingMessage, reply: ChannelReply): Promise<void> {
    if (!this.isAllowed(msg)) {
      await reply.send(`このボットを利用する権限がありません（あなたの ID: ${this.userKey(msg)}）。`);
      return;
    }
    const text = msg.text.trim();
    const command = text.match(/^[/!](help|new|stop|status|approve|deny)\b\s*(.*)$/i);
    if (command) return this.command(msg, reply, command[1].toLowerCase(), command[2].trim());
    if (!text && !msg.images?.length) return;

    let sessionId = this.sessionFor(msg.conversationKey);
    if (!sessionId) {
      sessionId = await this.runtime.createSession({ owner: msg.owner, channel: msg.channel, title: text || '画像' });
      const id = sessionId;
      this.writeMap(map => { map[msg.conversationKey] = id; });
    }
    const typing = reply.typing ? setInterval(() => reply.typing!(), 8000) : undefined;
    reply.typing?.();
    const onEvent = (e: AgentEvent) => {
      if (e.type === 'permission_request') {
        const r = e.request;
        const who = this.isApprover(msg) ? '' : '\n（承認は承認者のみ可能です。Web UI からも承認できます）';
        void reply.send(`🔐 ツールの実行に承認が必要です\n${r.tool}: ${r.summary.slice(0, 500)}\n承認: /approve ${r.id}\n拒否: /deny ${r.id}${who}`).catch(() => undefined);
      }
    };
    try {
      const result = await this.runtime.send(sessionId, text || 'この画像について教えてください。', { images: msg.images, onEvent });
      const suffix = result.stopReason === 'end_turn' ? '' : `\n\n（${result.stopReason === 'cancelled' ? '中断しました' : result.error ?? result.stopReason}）`;
      if (result.text || suffix) await reply.send(`${result.text}${suffix}`.trim());
    } catch (err) {
      await reply.send(`エラーが発生しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (typing) clearInterval(typing);
    }
  }

  private async command(msg: IncomingMessage, reply: ChannelReply, name: string, arg: string): Promise<void> {
    const sessionId = this.sessionFor(msg.conversationKey);
    switch (name) {
      case 'help':
        return reply.send(HELP);
      case 'new':
        if (sessionId) this.runtime.cancel(sessionId);
        this.writeMap(map => { delete map[msg.conversationKey]; });
        return reply.send('新しい会話を始めます。');
      case 'stop':
        return reply.send(sessionId && this.runtime.cancel(sessionId) ? '処理を止めました。' : '実行中の処理はありません。');
      case 'status': {
        const s = sessionId ? this.runtime.getSession(sessionId) : undefined;
        if (!s) return reply.send(`会話はまだありません。モデル: ${this.runtime.config.model}`);
        return reply.send(`会話: ${s.title}\nモデル: ${s.model}\n使用量: ${(s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheReadTokens).toLocaleString()} tokens${s.costUsd ? ` / $${s.costUsd.toFixed(4)}` : ''}${s.running ? '\n実行中です' : ''}`);
      }
      case 'approve':
      case 'deny': {
        if (!arg) return reply.send(`使い方: /${name} <ID>`);
        if (!this.isApprover(msg)) return reply.send(`承認する権限がありません。copharness.json の channels.approvers に "${this.userKey(msg)}" を追加してください。`);
        const request = this.runtime.approvals.get(arg);
        if (!request) return reply.send('その承認リクエストは見つかりません（期限切れの可能性があります）。');
        this.runtime.resolveApproval(arg, name === 'approve' ? 'allow' : 'deny', this.userKey(msg));
        return reply.send(name === 'approve' ? `承認しました: ${request.tool}` : `拒否しました: ${request.tool}`);
      }
    }
  }
}

const gateways = new WeakMap<Runtime, ChannelGateway>();

export function getGateway(runtime: Runtime): ChannelGateway {
  let gateway = gateways.get(runtime);
  if (!gateway) {
    gateway = new ChannelGateway(runtime);
    gateways.set(runtime, gateway);
  }
  return gateway;
}

/** Drop duplicate webhook deliveries (platform retries). */
export class RecentIds {
  private readonly ids = new Map<string, number>();
  constructor(private readonly ttlMs = 10 * 60_000) {}
  seen(id: string | undefined): boolean {
    if (!id) return false;
    const now = Date.now();
    for (const [k, t] of this.ids) if (now - t > this.ttlMs) this.ids.delete(k);
    if (this.ids.has(id)) return true;
    this.ids.set(id, now);
    return false;
  }
}
