/**
 * CopHarness LINE Bot Webhook
 *
 * Receives webhook events from LINE Messaging API and replies via LLM.
 *
 * Required environment variables:
 *   LINE_CHANNEL_SECRET       – Channel secret (for signature verification)
 *   LINE_CHANNEL_ACCESS_TOKEN – Channel access token (for sending replies)
 *
 * LLM environment variables (same as the web API):
 *   GITHUB_COPILOT_API_KEY / COPILOT_PROVIDER_API_KEY / OPENAI_API_KEY / etc.
 *
 * Optional:
 *   LINE_MAX_HISTORY      – Max message pairs to keep per user (default: 20)
 *   COPILOT_SYSTEM_PROMPT – System prompt sent to the LLM
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSignature, messagingApi } from '@line/bot-sdk';
import { createAdapter, resolveProvider } from '../../../lib/adapterFactory';
import { type LLMMessage } from '../../../lib/adapter';

const MAX_HISTORY = Math.max(1, Number(process.env.LINE_MAX_HISTORY) || 20);
const SYSTEM_PROMPT = process.env.COPILOT_SYSTEM_PROMPT ?? '';

/** LINE text message character limit */
const LINE_MESSAGE_MAX_LENGTH = 5000;

/** Per-user conversation history (keyed by LINE userId) */
const userHistory = new Map<string, LLMMessage[]>();

function getHistory(userId: string): LLMMessage[] {
  if (!userHistory.has(userId)) {
    const history: LLMMessage[] = [];
    if (SYSTEM_PROMPT) {
      history.push({ role: 'system', content: SYSTEM_PROMPT });
    }
    userHistory.set(userId, history);
  }
  return userHistory.get(userId)!;
}

function trimHistory(history: LLMMessage[]): void {
  const systemMessages = history.filter((m) => m.role === 'system');
  const nonSystem = history.filter((m) => m.role !== 'system');
  if (nonSystem.length > MAX_HISTORY * 2) {
    const trimmed = nonSystem.slice(-MAX_HISTORY * 2);
    history.length = 0;
    history.push(...systemMessages, ...trimmed);
  }
}

function truncateMessage(text: string): string {
  return text.length > LINE_MESSAGE_MAX_LENGTH ? text.slice(0, LINE_MESSAGE_MAX_LENGTH) : text;
}

/** Minimal typings for LINE webhook event payload */
interface LineSource {
  type: string;
  userId?: string;
}

interface LineTextMessage {
  type: 'text';
  id: string;
  text: string;
}

interface LineMessageEvent {
  type: 'message';
  replyToken: string;
  source: LineSource;
  message: LineTextMessage | { type: string };
}

interface LineFollowEvent {
  type: 'follow';
  replyToken: string;
  source: LineSource;
}

interface LineWebhookBody {
  destination: string;
  events: Array<LineMessageEvent | LineFollowEvent | { type: string }>;
}

export async function POST(req: NextRequest) {
  const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? '';
  const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';

  if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('[LINE Bot] LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN is not configured.');
    return NextResponse.json(
      { error: 'LINE credentials not configured' },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';

  if (!validateSignature(rawBody, LINE_CHANNEL_SECRET, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    // Acknowledge empty payloads (e.g. LINE webhook verification)
    return NextResponse.json({ ok: true });
  }

  // Create the LINE client early — needed for both greetings and message replies
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  });

  // Process events: greet on follow (no LLM needed), handle message events with LLM
  let hasMessageEvents = false;
  for (const event of body.events) {
    if (event.type === 'follow') {
      const followEvent = event as LineFollowEvent;
      const replyToken = followEvent.replyToken;
      if (!replyToken) continue;
      const greeting =
        process.env.LINE_GREETING_MESSAGE ||
        'こんにちは！CopHarness AIアシスタントです 🤖\n' +
        'メッセージを送ると、AIがお答えします。お気軽にお話しください！';
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: greeting }],
      });
    } else if (event.type === 'message') {
      hasMessageEvents = true;
    }
  }

  if (!hasMessageEvents) {
    return NextResponse.json({ ok: true });
  }

  const provider = resolveProvider();
  const localProviders = ['lmstudio', 'lemonade'];
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ||
    process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (!apiKey && !localProviders.includes(provider)) {
    console.error('[LINE Bot] No LLM API key configured.');
    // Return 200 to prevent LINE from retrying
    return NextResponse.json({ ok: true });
  }

  const model =
    process.env.COPILOT_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.GEMINI_MODEL ||
    process.env.LMSTUDIO_MODEL ||
    process.env.LEMONADE_MODEL ||
    'gpt-5-mini';

  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const adapter = createAdapter({ provider, model, apiKey, timeoutMs });

  for (const event of body.events) {
    if (event.type !== 'message') continue;

    const msgEvent = event as LineMessageEvent;
    if (msgEvent.message.type !== 'text') continue;

    const textMessage = msgEvent.message as LineTextMessage;
    const replyToken = msgEvent.replyToken;
    const userId = msgEvent.source.userId;
    const userText = textMessage.text.trim();

    if (!replyToken || !userId || !userText) continue;

    const history = getHistory(userId);
    history.push({ role: 'user', content: userText });
    trimHistory(history);

    try {
      const resp = await adapter.complete({ messages: [...history], timeoutMs });
      const replyText = resp.content || '（応答がありませんでした）';

      history.push({ role: 'assistant', content: replyText });
      trimHistory(history);

      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: truncateMessage(replyText) }],
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[LINE Bot] LLM error:', err);
      // Remove the user message that failed so history stays clean
      const idx = history.findLastIndex((m) => m.role === 'user' && m.content === userText);
      if (idx !== -1) history.splice(idx, 1);
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: `エラーが発生しました: ${errMsg.slice(0, 200)}` }],
      });
    }
  }

  return NextResponse.json({ ok: true });
}
