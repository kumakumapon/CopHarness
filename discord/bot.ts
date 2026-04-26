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
 *   DISCORD_PREFIX         – Command prefix (default: "!")
 *   COPILOT_SYSTEM_PROMPT  – System prompt sent to the LLM
 *   DISCORD_MAX_HISTORY    – Max messages to keep per channel (default: 20)
 *   DISCORD_MAX_IMAGE_BYTES – Max bytes per image attachment to download (default: 8388608 = 8 MB)
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
} from 'discord.js';
import { createAdapter, resolveProvider } from '../lib/adapterFactory';
import { type LLMAdapter, type LLMAttachment, type LLMMessage } from '../lib/adapter';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
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
