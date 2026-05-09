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
 *
 * Prompt Wizard commands (DM or @mention):
 *   !wizard            – Show template list
 *   !wizard <number>   – Select template and start wizard
 *   !wizard cancel     – Cancel current wizard session
 *   !run               – Execute the generated prompt with the LLM
 *   During wizard: reply normally to answer questions
 *   "キャンセル" or "cancel" – Cancel wizard at any step
 *   "実行" / "はい" / "yes" / "run" – Execute when prompt is ready
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
import { loadHistory, saveHistory } from '../lib/history/store';
import { trimHistoryToTokenBudget } from '../lib/history/trimmer';
import {
  getSession as getWizardSession,
  clearSession as clearWizardSession,
  enterSelectingMode,
  selectTemplate as wizSelectTemplate,
  continueWizard as wizContinue,
  promptTemplates,
} from '../lib/promptWizardSession';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_PREFIX = process.env.DISCORD_PREFIX ?? '!';
const SYSTEM_PROMPT = process.env.COPILOT_SYSTEM_PROMPT ?? '';
const MAX_HISTORY = Math.max(1, Number(process.env.DISCORD_MAX_HISTORY) || 20);
const DISCORD_RESPONSE_MAX_LENGTH = 2000;
const MAX_IMAGE_BYTES = Number(process.env.DISCORD_MAX_IMAGE_BYTES) || 8 * 1024 * 1024;

if (!DISCORD_BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN is not set.');
  process.exit(1);
}

const channelHistory = new Map<string, LLMMessage[]>();

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
    const persisted = loadHistory(`discord:${channelId}`);
    const history: LLMMessage[] = persisted.length > 0 ? persisted : [];
    if (history.length === 0 && SYSTEM_PROMPT) {
      history.push({ role: 'system', content: SYSTEM_PROMPT });
    }
    channelHistory.set(channelId, history);
  }
  return channelHistory.get(channelId)!;
}

async function persistChannelHistory(channelId: string, history: LLMMessage[]): Promise<void> {
  try {
    await saveHistory(`discord:${channelId}`, history);
  } catch (err) {
    console.warn('[Discord Bot] Failed to persist conversation history:', err);
  }
}

function trimHistory(history: LLMMessage[]): void {
  trimHistoryToTokenBudget(history, undefined, undefined, MAX_HISTORY * 2);
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
    const slice = remaining.slice(0, DISCORD_RESPONSE_MAX_LENGTH);
    const lastNewline = slice.lastIndexOf('\n');
    const splitAt = lastNewline > DISCORD_RESPONSE_MAX_LENGTH / 2 ? lastNewline : DISCORD_RESPONSE_MAX_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

function formatScheduleNotification(
  scheduleName: string,
  payload: { status: 'success' | 'failed' | 'aborted'; message: string },
): { header: string; body: string } {
  switch (payload.status) {
    case 'success':
      return {
        header: `📅 **スケジュール実行完了: ${scheduleName}**\n`,
        body: payload.message,
      };
    case 'failed':
      return {
        header: `❌ **スケジュール実行失敗: ${scheduleName}**\n`,
        body: `エラー: ${payload.message}`,
      };
    case 'aborted':
      return {
        header: `⏹️ **スケジュール実行中断: ${scheduleName}**\n`,
        body: `中断: ${payload.message}`,
      };
    default:
      return {
        header: `📅 **スケジュール実行通知: ${scheduleName}**\n`,
        body: payload.message,
      };
  }
}

async function sendInChunks(message: Message, text: string): Promise<void> {
  const chunks = splitLongMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      await message.reply(chunks[i]);
    } else if ('send' in message.channel && typeof message.channel.send === 'function') {
      await (message.channel as { send: (t: string) => Promise<unknown> }).send(chunks[i]);
    }
  }
}

// ── Schedule command helpers ───────────────────────────────────────────────────────────

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
    lines.push(`[${status}] ${s.id.slice(0, 8)} | ${s.name} | ${s.cron}`);
    lines.push(`       次回: ${nextStr}`);
    lines.push(`       プロンプト: ${s.prompt.length > 60 ? s.prompt.slice(0, 57) + '...' : s.prompt}`);
  }
  lines.push('```');
  return lines.join('\n');
}

function parseScheduleAdd(args: string): { cron: string; prompt: string; name: string } | string {
  const tokens: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === ' ') { i++; continue; }
    if (args[i] === '"' || args[i] === "'") {
      const q = args[i]; i++;
      let tok = '';
      while (i < args.length && args[i] !== q) {
        if (args[i] === '\\' && i + 1 < args.length) { i++; tok += args[i]; }
        else { tok += args[i]; }
        i++;
      }
      i++;
      tokens.push(tok);
    } else {
      let tok = '';
      while (i < args.length && args[i] !== ' ') { tok += args[i]; i++; }
      tokens.push(tok);
    }
  }

  if (tokens.length < 2) return '使い方: `!schedule add <時間指定> <プロンプト> [--name <名前>]`';

  const cron = tokens[0];
  let prompt = tokens[1];
  let name = 'Unnamed';
  const nameIdx = tokens.indexOf('--name');
  if (nameIdx !== -1 && tokens[nameIdx + 1]) name = tokens[nameIdx + 1];

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
      const rest = args.trim().slice(3).trim();
      const parsed = parseScheduleAdd(rest);
      if (typeof parsed === 'string') { await message.reply(`エラー: ${parsed}`); return; }

      let resolvedCron: string;
      try {
        resolvedCron = await resolveCronExpression(parsed.cron);
      } catch (err) {
        await message.reply(`エラー: ${err instanceof Error ? err.message : String(err)}`); return;
      }

      const entry = addSchedule({
        name: parsed.name,
        cron: resolvedCron,
        prompt: parsed.prompt,
        discordChannelId: message.channelId,
      });
      const next = nextRunDate(normalizeCron(resolvedCron), new Date());
      const nextStr = next ? next.toLocaleString('ja-JP') : '不明';
      const cronNote = resolvedCron !== parsed.cron
        ? `\n（"${parsed.cron}" → \`${resolvedCron}\` に解釈しました）`
        : '';
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

// ── Prompt Wizard command helpers ──────────────────────────────────────────────

async function handleWizardCommand(
  message: Message,
  args: string,
  channelKey: string,
  adapter: LLMAdapter,
): Promise<void> {
  const sub = args.trim().split(/\s+/)[0]?.toLowerCase();

  if (sub === 'cancel') {
    clearWizardSession(channelKey);
    await message.reply('ウィザードをキャンセルしました。');
    return;
  }

  if (!sub || sub === 'list') {
    await message.reply(enterSelectingMode(channelKey));
    return;
  }

  const num = parseInt(sub, 10);
  if (!isNaN(num) && num >= 1) {
    if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();
    const reply = await wizSelectTemplate(channelKey, num, adapter);
    await sendInChunks(message, reply);
    return;
  }

  // Search by Japanese name
  const idx = promptTemplates.findIndex(
    (t) => t.nameJa.includes(args.trim()) || t.id.toLowerCase().includes(args.trim().toLowerCase()),
  );
  if (idx !== -1) {
    if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();
    const reply = await wizSelectTemplate(channelKey, idx + 1, adapter);
    await sendInChunks(message, reply);
    return;
  }

  await message.reply(
    '```\n' +
    'プロンプトウィザード コマンド:\n' +
    '  !wizard          – テンプレート一覧を表示\n' +
    '  !wizard <番号>   – テンプレートを選択して開始\n' +
    '  !wizard cancel   – ウィザードをキャンセル\n' +
    '  !run             – 生成したプロンプトを LLM に実行\n' +
    '```',
  );
}

async function sendWizardComplete(
  message: Message,
  wizardText: string,
  generatedPrompt: string,
): Promise<void> {
  const promptPreview =
    generatedPrompt.length > 1400
      ? generatedPrompt.slice(0, 1400) + '\n...(以下省略)'
      : generatedPrompt;
  const fullText =
    `${wizardText}\n\n` +
    `📋 **生成されたプロンプト:**\n\`\`\`\n${promptPreview}\n\`\`\`\n\n` +
    `▶️ \`!run\` で実行｜「キャンセル」でキャンセル`;
  await sendInChunks(message, fullText);
}

async function executeWizardPrompt(
  message: Message,
  channelKey: string,
  generatedPrompt: string,
  adapter: LLMAdapter,
): Promise<void> {
  clearWizardSession(channelKey);
  if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();
  try {
    const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
    const resp = await adapter.complete({
      messages: [{ role: 'user', content: generatedPrompt }],
      timeoutMs,
    });
    await sendInChunks(message, resp.content || '（応答がありませんでした）');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await message.reply(`実行エラー: ${msg.slice(0, 200)}`);
  }
}

// ── Message handling ──────────────────────────────────────────────────────────────────

async function handleMessage(
  message: Message,
  adapter: LLMAdapter,
  botUserId: string,
): Promise<void> {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMention = message.mentions.has(botUserId);
  if (!isDM && !isMention) return;

  let userText = message.content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .trim();

  // ── !schedule commands (existing) ──
  const scheduleCmd = `${DISCORD_PREFIX}schedule`;
  if (userText.startsWith(scheduleCmd)) {
    const args = userText.slice(scheduleCmd.length).trim();
    await handleScheduleCommand(message, args);
    return;
  }

  // ── !wizard commands ──
  const wizardCmd = `${DISCORD_PREFIX}wizard`;
  const channelKey = `discord:${message.channelId}`;

  if (userText.startsWith(wizardCmd)) {
    const args = userText.slice(wizardCmd.length).trim();
    await handleWizardCommand(message, args, channelKey, adapter);
    return;
  }

  // ── !run — execute wizard-generated prompt ──
  if (userText === `${DISCORD_PREFIX}run`) {
    const wizSess = getWizardSession(channelKey);
    if (wizSess?.stage === 'ready' && wizSess.generatedPrompt) {
      await executeWizardPrompt(message, channelKey, wizSess.generatedPrompt, adapter);
    } else {
      await message.reply(
        '実行できるプロンプトがありません。先に `!wizard` でプロンプトを生成してください。',
      );
    }
    return;
  }

  // Collect image attachments
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
  if (!userText) userText = '画像について教えてください。';

  // ── Route to wizard session if active (text-only; skip when images attached) ──
  const wizSess = getWizardSession(channelKey);
  if (wizSess && attachments.length === 0) {
    const lowerText = userText.toLowerCase();

    if (lowerText === 'キャンセル' || lowerText === 'cancel') {
      clearWizardSession(channelKey);
      await message.reply('ウィザードをキャンセルしました。');
      return;
    }

    if (wizSess.stage === 'selecting') {
      const num = parseInt(userText.trim(), 10);
      if (!isNaN(num) && num >= 1) {
        if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();
        const reply = await wizSelectTemplate(channelKey, num, adapter);
        await sendInChunks(message, reply);
      } else {
        await message.reply('番号を入力してテンプレートを選択してください。');
      }
      return;
    }

    if (wizSess.stage === 'collecting') {
      if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();
      const result = await wizContinue(channelKey, userText, adapter);
      if (result.type === 'complete') {
        await sendWizardComplete(message, result.text, result.generatedPrompt);
      } else {
        await sendInChunks(message, result.text);
      }
      return;
    }

    if (wizSess.stage === 'ready' && wizSess.generatedPrompt) {
      if (lowerText === '実行' || lowerText === 'はい' || lowerText === 'yes' || lowerText === 'run') {
        await executeWizardPrompt(message, channelKey, wizSess.generatedPrompt, adapter);
      } else {
        await message.reply(
          '`!run` または「実行」でプロンプトを実行。「キャンセル」でキャンセル。',
        );
      }
      return;
    }
  }

  // ── Normal LLM chat (existing) ──
  const channelId = message.channelId;
  const history = getHistory(channelId);
  history.push({ role: 'user', content: userText });
  trimHistory(history);

  try {
    if ('sendTyping' in message.channel) await (message.channel as any).sendTyping();

    const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
    const resp = await adapter.complete({ messages: [...history], attachments, timeoutMs });
    const replyText = resp.content || '（応答がありませんでした）';

    history.push({ role: 'assistant', content: replyText });
    trimHistory(history);
    await persistChannelHistory(channelId, history);

    await sendInChunks(message, replyText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Discord Bot] LLM error:', err);
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

    const defaultNotifyChannel = process.env.DISCORD_SCHEDULE_CHANNEL;
    startScheduler(async (channelId, scheduleName, payload) => {
      const targetId = defaultNotifyChannel ?? channelId;
      try {
        const ch = await client.channels.fetch(targetId);
        if (ch && ch instanceof TextChannel) {
          const { header, body } = formatScheduleNotification(scheduleName, payload);
          const chunks = splitLongMessage(header + body);
          for (const chunk of chunks) await ch.send(chunk);
        }
      } catch (err) {
        console.error(`[Discord Bot] Failed to post schedule result to channel ${targetId}:`, err);
      }
    });

    const greetingChannelId =
      process.env.DISCORD_GREETING_CHANNEL || process.env.DISCORD_SCHEDULE_CHANNEL;
    if (greetingChannelId) {
      const greeting =
        process.env.DISCORD_GREETING_MESSAGE ||
        `こんにちは！CopHarness ボット（${c.user.tag}）が起動しました 🤖\n` +
        `AI会話やスケジュール管理をお手伝いします。\`${DISCORD_PREFIX}schedule help\` でスケジュール機能、\`${DISCORD_PREFIX}wizard\` でプロンプトウィザードをご確認できます。`;
      client.channels
        .fetch(greetingChannelId)
        .then((ch) => { if (ch instanceof TextChannel) return ch.send(greeting); })
        .catch((err) => { console.error('[Discord Bot] Failed to send startup greeting:', err); });
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
