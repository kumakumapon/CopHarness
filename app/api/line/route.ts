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
 *
 * Prompt Wizard:
 *   "ウィザード" or "wizard"  – Show template list
 *   "1"、3 (数字)             – Select template when in selection mode
 *   "キャンセル" or "cancel"  – Cancel wizard at any step
 *   "実行" / "はい" / "yes"   – Execute generated prompt with LLM
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSignature, messagingApi } from '@line/bot-sdk';
import { createAdapter, resolveProvider } from '../../../lib/adapterFactory';
import { type LLMMessage } from '../../../lib/adapter';
import { loadHistory, saveHistory } from '../../../lib/history/store';
import { trimHistoryToTokenBudget } from '../../../lib/history/trimmer';
import {
  getSession as getWizardSession,
  clearSession as clearWizardSession,
  enterSelectingMode,
  selectTemplate as wizSelectTemplate,
  continueWizard as wizContinue,
} from '../../../lib/promptWizardSession';

const MAX_HISTORY = Math.max(1, Number(process.env.LINE_MAX_HISTORY) || 20);
const SYSTEM_PROMPT = process.env.COPILOT_SYSTEM_PROMPT ?? '';
const LINE_MESSAGE_MAX_LENGTH = 5000;

const userHistory = new Map<string, LLMMessage[]>();

function getHistory(userId: string): LLMMessage[] {
  if (!userHistory.has(userId)) {
    const persisted = loadHistory(`line:${userId}`);
    const history: LLMMessage[] = persisted.length > 0 ? persisted : [];
    if (history.length === 0 && SYSTEM_PROMPT) {
      history.push({ role: 'system', content: SYSTEM_PROMPT });
    }
    userHistory.set(userId, history);
  }
  return userHistory.get(userId)!;
}

async function persistHistory(userId: string, history: LLMMessage[]): Promise<void> {
  try {
    await saveHistory(`line:${userId}`, history);
  } catch (err) {
    console.warn('[LINE Bot] Failed to persist conversation history:', err);
  }
}

function trimHistory(history: LLMMessage[]): void {
  trimHistoryToTokenBudget(history, undefined, undefined, MAX_HISTORY * 2);
}

function truncateMessage(text: string): string {
  return text.length > LINE_MESSAGE_MAX_LENGTH ? text.slice(0, LINE_MESSAGE_MAX_LENGTH) : text;
}

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
    return NextResponse.json({ error: 'LINE credentials not configured' }, { status: 503 });
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
    return NextResponse.json({ ok: true });
  }

  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  });

  let hasMessageEvents = false;
  for (const event of body.events) {
    if (event.type === 'follow') {
      const followEvent = event as LineFollowEvent;
      if (!followEvent.replyToken) continue;
      const greeting =
        process.env.LINE_GREETING_MESSAGE ||
        'こんにちは！CopHarness AIアシスタントです 🤖\n' +
        '「ウィザード」と送ると AIが質問しながらプロンプトを作成します。\n' +
        'メッセージを送ると、AIがお答えします。お気軽にお話しください！';
      await client.replyMessage({
        replyToken: followEvent.replyToken,
        messages: [{ type: 'text', text: greeting }],
      });
    } else if (event.type === 'message') {
      hasMessageEvents = true;
    }
  }

  if (!hasMessageEvents) return NextResponse.json({ ok: true });

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

    const sessionKey = `line:${userId}`;
    const wizSess = getWizardSession(sessionKey);
    const lowerText = userText.toLowerCase();

    // ── Wizard: cancel ──
    if (wizSess && (lowerText === 'キャンセル' || lowerText === 'cancel')) {
      clearWizardSession(sessionKey);
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: 'ウィザードをキャンセルしました。' }],
      });
      continue;
    }

    // ── Wizard: trigger ──
    if (
      !wizSess &&
      (lowerText === 'ウィザード' || lowerText === 'wizard' || lowerText === 'プロンプトウィザード')
    ) {
      const reply = enterSelectingMode(sessionKey);
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: truncateMessage(reply) }],
      });
      continue;
    }

    // ── Wizard: template selection ──
    if (wizSess?.stage === 'selecting') {
      const num = parseInt(userText.trim(), 10);
      if (!isNaN(num) && num >= 1) {
        try {
          const reply = await wizSelectTemplate(sessionKey, num, adapter);
          await client.replyMessage({
            replyToken,
            messages: [{ type: 'text', text: truncateMessage(reply) }],
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await client.replyMessage({
            replyToken,
            messages: [{ type: 'text', text: `エラーが発生しました: ${errMsg.slice(0, 200)}` }],
          });
        }
      } else {
        await client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: '番号を入力してテンプレートを選択してください。（例: 1）' }],
        });
      }
      continue;
    }

    // ── Wizard: collecting answers ──
    if (wizSess?.stage === 'collecting') {
      try {
        const result = await wizContinue(sessionKey, userText, adapter);
        if (result.type === 'complete') {
          const promptPreview =
            result.generatedPrompt.length > 2500
              ? result.generatedPrompt.slice(0, 2500) + '\n...(以下省略)'
              : result.generatedPrompt;
          const replyText =
            `${result.text}\n\n` +
            `📋 生成されたプロンプト:\n${promptPreview}\n\n` +
            `「実行」または「はい」で LLM に実行します。\n「キャンセル」でウィザードを終了します。`;
          await client.replyMessage({
            replyToken,
            messages: [{ type: 'text', text: truncateMessage(replyText) }],
          });
        } else {
          await client.replyMessage({
            replyToken,
            messages: [{ type: 'text', text: truncateMessage(result.text) }],
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: `エラーが発生しました: ${errMsg.slice(0, 200)}` }],
        });
      }
      continue;
    }

    // ── Wizard: ready — execute prompt ──
    if (
      wizSess?.stage === 'ready' &&
      wizSess.generatedPrompt &&
      (lowerText === '実行' || lowerText === 'はい' || lowerText === 'yes' || lowerText === 'run')
    ) {
      const prompt = wizSess.generatedPrompt;
      clearWizardSession(sessionKey);
      try {
        const resp = await adapter.complete({
          messages: [{ role: 'user', content: prompt }],
          timeoutMs,
        });
        await client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: truncateMessage(resp.content || '（応答がありませんでした）') }],
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: `実行エラー: ${errMsg.slice(0, 200)}` }],
        });
      }
      continue;
    }

    // ── Normal LLM chat (existing) ──
    const history = getHistory(userId);
    history.push({ role: 'user', content: userText });
    trimHistory(history);

    try {
      const resp = await adapter.complete({ messages: [...history], timeoutMs });
      const replyText = resp.content || '（応答がありませんでした）';
      history.push({ role: 'assistant', content: replyText });
      trimHistory(history);
      await persistHistory(userId, history);
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: truncateMessage(replyText) }],
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[LINE Bot] LLM error:', err);
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
