/**
 * CopHarness Discord Bot
 * Connects a Discord bot to an LLM provider.
 *
 * Usage:
 *   npm run discord
 *
 * Required environment variables:
 *   DISCORD_BOT_TOKEN   – Discord bot token (from https://discord.com/developers/applications)
 *
 * LLM environment variables (same as the web API):
 *   GITHUB_COPILOT_API_KEY / COPILOT_PROVIDER_API_KEY / OPENAI_API_KEY / etc.
 *
 * Optional:
 *   DISCORD_PREFIX              – Command prefix (default: "!")
 *   COPILOT_SYSTEM_PROMPT       – System prompt sent to the LLM
 *   DISCORD_MAX_HISTORY         – Max messages to keep per channel (default: 20)
 *   DISCORD_MAX_IMAGE_BYTES     – Max bytes per image attachment to download (default: 8388608 = 8 MB)
 *   DISCORD_SCHEDULE_CHANNEL    – Channel ID where autonomous schedule results are posted
 *                                  (overrides per-schedule channel if set)
 *
 * Schedule commands (DM or @mention):
 *   !schedule list
 *   !schedule add <cron|HH:MM> <prompt> [--name <name>]
 *   !schedule remove <id>
 *   !schedule enable <id>
 *   !schedule disable <id>
 *   !schedule fire <id>
 *   !schedule stop <id>
 *   !schedule help
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local if present (dev convenience)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
  TextChannel,
} from 'discord.js';
import { createAdapter, resolveProvider } from '../lib/adapterFactory';
import { type LLMAdapter, type LLMAttachment, type LLMMessage } from '../lib/adapter';
import {
  listSchedules,
  addSchedule,
  removeSchedule,
  setEnabled,
  setRunNow,
  setStopRequested,
} from '../lib/scheduler/store';
import { normalizeCron, nextRunDate } from '../lib/scheduler/cron';
import { startScheduler, resolveCronExpression } from '../lib/scheduler/engine';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_PREFIX = process.env.DISCORD_PREFIX ?? '!';
const SYSTEM_PROMPT = process.env.COPILOT_SYSTEM_PROMPT ?? '';
const MAX_HISTORY = Math.max(1, Number(process.env.DISCORD_MAX_HISTORY) || 20);
const DISCORD_RESPONSE_MAX_LENGTH = 2000; // Discord message character limit
// Maximum size (bytes) for a single image attachment to download (default: 8 MB)
const MAX_IMAGE_BYTES = Number(process.env.DISCORD_MAX_IMAGE_BYTES) || 8 * 1024 * 1024;

if (!DISCORD_BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN is not set.');
  process.exit(1);
}

// Per-channel conversation history
const channelHistory = new Map<string, LLMMessage[]>();

/**
 * Download an image URL and return it as a base64-encoded LLMAttachment.
 * Returns null if the content type is not an image or the file exceeds MAX_IMAGE_BYTES.
 */
async function fetchImageAttachment(
  url: string,
  contentType: string | null,
): Promise<LLMAttachment | null> {
  const mimeType = contentType ?? '';
  if (!mimeType.startsWith('image/')) return null;

  const resp = await fetch(url);
  if (!resp.ok) return null;

  const contentLength = Number(resp.headers.get('content-length') ?? 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    console.warn(`[Discord Bot] Skipping image attachment: size ${contentLength} exceeds limit ${MAX_IMAGE_BYTES}`);
    return null;
  }

  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    console.warn(`[Discord Bot] Skipping image attachment: downloaded size ${buffer.byteLength} exceeds limit ${MAX_IMAGE_BYTES}`);
    return null;
  }

  const data = Buffer.from(buffer).toString('base64');
  return { type: 'blob', data, mimeType };
}

function getHistory(channelId: string): LLMMessage[] {
  if (!channelHistory.has(channelId)) {
    const history: LLMMessage[] = [];
    if (SYSTEM_PROMPT) {
      history.push({ role: 'system', content: SYSTEM_PROMPT });
    }
    channelHistory.set(channelId, history);
  }
  return channelHistory.get(channelId)!;
}

function trimHistory(history: LLMMessage[]): void {
  // Keep system message (if any) + last MAX_HISTORY user/assistant exchanges
  const systemMessages = history.filter((m) => m.role === 'system');
  const nonSystem = history.filter((m) => m.role !== 'system');
  if (nonSystem.length > MAX_HISTORY * 2) {
    const trimmed = nonSystem.slice(-MAX_HISTORY * 2);
    history.length = 0;
    history.push(...systemMessages, ...trimmed);
  }
}

function splitLongMessage(text: string): string[] {
  if (text.length <= DISCORD_RESPONSE_MAX_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_RESPONSE_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline boundary within the limit
    const slice = remaining.slice(0, DISCORD_RESPONSE_MAX_LENGTH);
    const lastNewline = slice.lastIndexOf('\n');
    const splitAt = lastNewline > DISCORD_RESPONSE_MAX_LENGTH / 2 ? lastNewline : DISCORD_RESPONSE_MAX_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

// ── Schedule command helpers ──────────────────────────────────────────────────

const SCHEDULE_HELP = `\`\`\`
スケジュール管理コマンド:
  !schedule list                              スケジュール一覧を表示
  !schedule add <時間指定> <プロンプト>          スケジュールを追加（このチャンネルへ結果を投稿）
    --name <名前>                             任意のラベル
  !schedule remove <id>                       スケジュールを削除（ID の先頭文字も可）
  !schedule enable <id>                       スケジュールを有効化
  !schedule disable <id>                      スケジュールを無効化
  !schedule fire <id>                         スケジュールをすぐに実行
  !schedule stop <id>                         実行中のスケジュールを中止
  !schedule help                              このヘルプを表示

時間指定（自然言語・cron・HH:MM いずれも可）:
  "HH:MM"            例: "09:00"  → 毎日 09:00
  "分 時 日 月 曜日"  例: "0 9 * * *"
  "*/N ..."          例: "*/30 * * * *"  → 30分おき
  自然言語           例: "毎日朝9時"  "毎週金曜18時"  "30分おき"

例:
  !schedule add "09:00" "今日の作業内容を提案して" --name 朝のブリーフィング
  !schedule add "毎週金曜18時" "今週の振り返りをして" --name 週次レビュー
  !schedule add "毎日朝9時" "おはようございます。今日のタスクを提案して"
  !schedule list
  !schedule remove abc123
\`\`\``;

function resolveScheduleId(prefix: string): string | null {
  const schedules = listSchedules();
  const match = schedules.find((s) => s.id.startsWith(prefix));
  return match?.id ?? null;
}

function formatScheduleList(): string {
  const schedules = listSchedules();
  if (schedules.length === 0) {
    return '登録済みのスケジュールはありません。';
  }

  const now = new Date();
  const lines: string[] = ['**登録済みスケジュール**\n```'];
  for (const s of schedules) {
    const next = s.enabled ? nextRunDate(normalizeCron(s.cron), now) : null;
    const status = s.enabled ? '✓' : '✗';
    const nextStr = next ? next.toLocaleString('ja-JP') : '-';
    const channelStr = s.discordChannelId ? ` → <#${s.discordChannelId}>` : '';
    lines.push(
      `[${status}] ${s.id.slice(0, 8)} | ${s.name} | ${s.cron}${channelStr}`,
    );
    lines.push(`       次回: ${nextStr}`);
    lines.push(`       プロンプト: ${s.prompt.length > 60 ? s.prompt.slice(0, 57) + '...' : s.prompt}`);
  }
  lines.push('```');
  return lines.join('\n');
}

/**
 * Parse a schedule add command string into { cron, prompt, name }.
 * The cron token may be quoted (single or double), and the prompt may also be quoted.
 * Remaining arguments after cron + prompt are parsed for --name.
 */
function parseScheduleAdd(args: string): { cron: string; prompt: string; name: string } | string {
  // Tokenise: handle single/double quoted strings and bare words
  const tokens: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === ' ') {
      i++;
      continue;
    }
    if (args[i] === '"' || args[i] === "'") {
      const q = args[i];
      i++;
      let tok = '';
      while (i < args.length && args[i] !== q) {
        if (args[i] === '\\' && i + 1 < args.length) {
          i++;
          tok += args[i];
        } else {
          tok += args[i];
        }
        i++;
      }
      i++; // closing quote
      tokens.push(tok);
    } else {
      let tok = '';
      while (i < args.length && args[i] !== ' ') {
        tok += args[i];
        i++;
      }
      tokens.push(tok);
    }
  }

  if (tokens.length < 2) {
    return '使い方: `!schedule add <時間指定> <プロンプト> [--name <名前>]`';
  }

  const cron = tokens[0];

  // Prompt may be the second quoted token, or bare tokens until --name
  let prompt = tokens[1];
  let name = 'Unnamed';

  const nameIdx = tokens.indexOf('--name');
  if (nameIdx !== -1 && tokens[nameIdx + 1]) {
    name = tokens[nameIdx + 1];
  }

  return { cron, prompt, name };
}

async function handleScheduleCommand(message: Message, args: string): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case 'list':
    case undefined:
    case '':
      await message.reply(formatScheduleList());
      return;

    case 'help':
      await message.reply(SCHEDULE_HELP);
      return;

    case 'add': {
      const rest = args.trim().slice(3).trim(); // strip "add"
      const parsed = parseScheduleAdd(rest);
      if (typeof parsed === 'string') {
        await message.reply(`エラー: ${parsed}`);
        return;
      }

      // Resolve cron: accepts HH:MM, 5-field cron, or natural language via LLM
      let resolvedCron: string;
      try {
        resolvedCron = await resolveCronExpression(parsed.cron);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await message.reply(`エラー: ${errMsg}`);
        return;
      }

      const entry = addSchedule({
        name: parsed.name,
        cron: resolvedCron,
        prompt: parsed.prompt,
        discordChannelId: message.channelId,
      });
      const next = nextRunDate(normalizeCron(resolvedCron), new Date());
      const nextStr = next ? next.toLocaleString('ja-JP') : '不明';
      const cronNote = resolvedCron !== parsed.cron ? `\n（"${parsed.cron}" → \`${resolvedCron}\` に解釈しました）` : '';
      await message.reply(
        `✅ スケジュールを追加しました\n` +
        `ID: \`${entry.id.slice(0, 8)}\`\n` +
        `名前: ${entry.name}\n` +
        `Cron: \`${resolvedCron}\`${cronNote}\n` +
        `プロンプト: ${entry.prompt}\n` +
        `次回実行: ${nextStr}\n` +
        `結果はこのチャンネルに投稿されます。`,
      );
      return;
    }

    case 'remove':
    case 'delete':
    case 'rm': {
      const prefix = parts[1];
      if (!prefix) { await message.reply('使い方: `!schedule remove <id>`'); return; }
      const id = resolveScheduleId(prefix);
      if (!id) { await message.reply(`ID が見つかりません: ${prefix}`); return; }
      removeSchedule(id);
      await message.reply(`🗑️ スケジュール \`${id.slice(0, 8)}\` を削除しました。`);
      return;
    }

    case 'enable':
    case 'disable': {
      const enabled = sub === 'enable';
      const prefix = parts[1];
      if (!prefix) { await message.reply(`使い方: \`!schedule ${sub} <id>\``); return; }
      const id = resolveScheduleId(prefix);
      if (!id) { await message.reply(`ID が見つかりません: ${prefix}`); return; }
      setEnabled(id, enabled);
      await message.reply(`${enabled ? '✅ 有効化' : '⏸️ 無効化'}しました: \`${id.slice(0, 8)}\``);
      return;
    }

    case 'fire': {
      const prefix = parts[1];
      if (!prefix) { await message.reply('使い方: `!schedule fire <id>`'); return; }
      const id = resolveScheduleId(prefix);
      if (!id) { await message.reply(`ID が見つかりません: ${prefix}`); return; }
      setRunNow(id, true);
      const s = listSchedules().find((x) => x.id === id);
      if (!s) { await message.reply(`スケジュールが見つかりません: ${prefix}`); return; }
      await message.reply(`⚡ スケジュール「${s.name}」(\`${id.slice(0, 8)}\`) を即時実行キューに登録しました。5 秒以内に実行されます。`);
      return;
    }

    case 'stop': {
      const prefix = parts[1];
      if (!prefix) { await message.reply('使い方: `!schedule stop <id>`'); return; }
      const id = resolveScheduleId(prefix);
      if (!id) { await message.reply(`ID が見つかりません: ${prefix}`); return; }
      setStopRequested(id, true);
      const s = listSchedules().find((x) => x.id === id);
      if (!s) { await message.reply(`スケジュールが見つかりません: ${prefix}`); return; }
      await message.reply(`🛑 スケジュール「${s.name}」(\`${id.slice(0, 8)}\`) の中止を要求しました。`);
      return;
    }

    default:
      await message.reply(`不明なサブコマンド: \`${sub}\`\n${SCHEDULE_HELP}`);
  }
}

// ── Message handling ──────────────────────────────────────────────────────────

async function handleMessage(
  message: Message,
  adapter: LLMAdapter,
  botUserId: string,
): Promise<void> {
  // Ignore messages from bots
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMention = message.mentions.has(botUserId);

  // Respond to DMs and @mentions
  if (!isDM && !isMention) return;

  // Strip the bot mention from the content
  let userText = message.content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .trim();

  // Intercept schedule management commands
  const scheduleCmd = `${DISCORD_PREFIX}schedule`;
  if (userText.startsWith(scheduleCmd)) {
    const args = userText.slice(scheduleCmd.length).trim();
    await handleScheduleCommand(message, args);
    return;
  }

  // Collect image attachments from the message
  const attachments: LLMAttachment[] = [];
  for (const attachment of message.attachments.values()) {
    if (!attachment.contentType?.startsWith('image/')) continue;
    const llmAttachment = await fetchImageAttachment(attachment.url, attachment.contentType).catch((err) => {
      console.warn(`[Discord Bot] Failed to fetch image attachment: ${err}`);
      return null;
    });
    if (llmAttachment) attachments.push(llmAttachment);
  }

  if (!userText && attachments.length === 0) {
    await message.reply('何かご用件はありますか？');
    return;
  }

  // When only images are sent (no text), use a default prompt
  if (!userText) {
    userText = '画像について教えてください。';
  }

  const channelId = message.channelId;
  const history = getHistory(channelId);
  history.push({ role: 'user', content: userText });
  trimHistory(history);

  try {
    // Show typing indicator while waiting for LLM
    if ('sendTyping' in message.channel) {
      await (message.channel as any).sendTyping();
    }

    const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
    const resp = await adapter.complete({ messages: [...history], attachments, timeoutMs });
    const replyText = resp.content || '（応答がありませんでした）';

    history.push({ role: 'assistant', content: replyText });
    trimHistory(history);

    // Send reply, splitting if necessary
    const chunks = splitLongMessage(replyText);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply(chunks[i]);
      } else if ('send' in message.channel && typeof message.channel.send === 'function') {
        await (message.channel as { send: (text: string) => Promise<unknown> }).send(chunks[i]);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Discord Bot] LLM error:`, err);
    // Remove the user message that failed so history stays clean
    const idx = history.lastIndexOf(history.find((m) => m.role === 'user' && m.content === userText)!);
    if (idx !== -1) history.splice(idx, 1);
    await message.reply(`エラーが発生しました: ${msg.slice(0, 200)}`);
  }
}

async function main() {
  const provider = resolveProvider();
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ||
    process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (!apiKey && provider !== 'copilot') {
    console.error(
      'Error: No LLM API key found. Set one of: GITHUB_COPILOT_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY',
    );
    process.exit(1);
  }

  const model =
    process.env.COPILOT_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.GEMINI_MODEL ||
    'gpt-5-mini';

  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const adapter = createAdapter({ provider, model, apiKey, timeoutMs });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`CopHarness Discord Bot ready — logged in as ${c.user.tag}`);
    console.log(`Provider: ${provider}, Model: ${model}`);

    // Start the embedded scheduler daemon.
    // When a scheduled prompt finishes, post the result to the stored Discord channel.
    const defaultNotifyChannel = process.env.DISCORD_SCHEDULE_CHANNEL;
    startScheduler(async (channelId, scheduleName, result) => {
      const targetId = defaultNotifyChannel ?? channelId;
      try {
        const ch = await client.channels.fetch(targetId);
        if (ch && ch instanceof TextChannel) {
          const header = `📅 **スケジュール実行完了: ${scheduleName}**\n`;
          const chunks = splitLongMessage(header + result);
          for (const chunk of chunks) {
            await ch.send(chunk);
          }
        }
      } catch (err) {
        console.error(`[Discord Bot] Failed to post schedule result to channel ${targetId}:`, err);
      }
    });

    // Send a startup greeting to the configured greeting or schedule channel
    const greetingChannelId =
      process.env.DISCORD_GREETING_CHANNEL || process.env.DISCORD_SCHEDULE_CHANNEL;
    if (greetingChannelId) {
      const greeting =
        process.env.DISCORD_GREETING_MESSAGE ||
        `こんにちは！CopHarness ボット（${c.user.tag}）が起動しました 🤖\n` +
        `AI会話やスケジュール管理をお手伝いします。\`${DISCORD_PREFIX}schedule help\` でスケジュール機能を確認できます。`;
      client.channels
        .fetch(greetingChannelId)
        .then((ch) => {
          if (ch instanceof TextChannel) return ch.send(greeting);
        })
        .catch((err) => {
          console.error('[Discord Bot] Failed to send startup greeting:', err);
        });
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!client.user) return;
    await handleMessage(message, adapter, client.user.id);
  });

  client.on(Events.Error, (err) => {
    console.error('[Discord Bot] Client error:', err);
  });

  await client.login(DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
