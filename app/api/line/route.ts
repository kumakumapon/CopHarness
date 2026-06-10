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
import { createAdapter, resolveProvider, resolveModel } from '../../../lib/adapterFactory';
import { type LLMMessage } from '../../../lib/adapter';
import { loadHistory, saveHistory } from '../../../lib/history/store';
import { resolveConversationKey } from '../../../lib/identity/store';
import { withSkillExecutionContext } from '../../../lib/skills/executionContext';
import { finishTask, startTask } from '../../../lib/tasks/ledger';
import { trimHistoryToTokenBudget } from '../../../lib/history/trimmer';
import {
  getSession as getWizardSession,
  clearSession as clearWizardSession,
  enterSelectingMode,
  selectTemplate as wizSelectTemplate,
  continueWizard as wizContinue,
} from '../../../lib/promptWizardSession';
import { consumePendingNudge, maybeCreateNudge } from '../../../lib/memory/nudge';

const MAX_HISTORY = Math.max(1, Number(process.env.LINE_MAX_HISTORY) || 20);
const SYSTEM_PROMPT = process.env.COPILOT_SYSTEM_PROMPT ?? '';
const LINE_MESSAGE_MAX_LENGTH = 5000;

const userHistory = new Map<string, LLMMessage[]>();

// Helper: reply with retry on transient failures
async function replyWithRetry(client: any, payload: any, attempts = 3): Promise<any> {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.replyMessage(payload);
    } catch (err) {
      lastErr = err;
      const waitMs = Math.pow(2, i) * 500; // exponential backoff: 500ms, 1000ms, 2000ms...
      console.warn('[LINE Bot] replyMessage failed, attempt', i + 1, 'of', attempts, 'waiting', waitMs, 'ms', err);
      // count retries metric if batching enabled below
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  console.error('[LINE Bot] replyMessage failed after retries:', lastErr);
  // Re-throw so callers can handle if necessary
  throw lastErr;
}

// --- Metrics and optional Sentry integration ---
const replyMetrics: Record<string, number> = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  retries: 0,
};
let Sentry: any = null;
if (process.env.SENTRY_DSN) {
  // dynamically import so package is optional and avoid using require
  // import() returns a promise; handle failures gracefully
  import('@sentry/node')
    .then((mod) => {
      const _Sentry = (mod && (mod.default ?? mod)) as any;
      _Sentry.init({ dsn: process.env.SENTRY_DSN });
      Sentry = _Sentry;
    })
    .catch((e) => {
      console.warn('[LINE Bot] Sentry not initialized or @sentry/node not installed:', e);
    });
}

function recordMetric(name: keyof typeof replyMetrics, delta = 1) {
  if (replyMetrics[name] === undefined) return;
  replyMetrics[name] += delta;
}

// --- Async batching configuration (disabled by default) ---
const LINE_REPLY_BATCH_ASYNC = process.env.LINE_REPLY_BATCH_ASYNC === 'true';
const REPLY_BATCH_INTERVAL = Number(process.env.LINE_REPLY_BATCH_INTERVAL_MS) || 200;
const REPLY_BATCH_SIZE = Number(process.env.LINE_REPLY_BATCH_SIZE) || 10;
const REPLY_CONCURRENCY = Number(process.env.LINE_REPLY_CONCURRENCY) || 3;

const replyQueue: Array<any> = [];
let replyWorkerRunning = false;

async function processReplyQueue(client: any) {
  if (replyWorkerRunning) return;
  replyWorkerRunning = true;
  try {
    while (replyQueue.length > 0) {
      const batch = replyQueue.splice(0, REPLY_BATCH_SIZE);
      // process in concurrency-limited chunks
      for (let i = 0; i < batch.length; i += REPLY_CONCURRENCY) {
        const chunk = batch.slice(i, i + REPLY_CONCURRENCY);
        await Promise.all(
          chunk.map(async (payload) => {
            try {
              recordMetric('attempted');
              await replyWithRetry(client, payload);
              recordMetric('succeeded');
            } catch (err) {
              recordMetric('failed');
              console.error('[LINE Bot] reply failed after retries:', err);
              if (Sentry) Sentry.captureException(err);
            }
          })
        );
      }
    }
  } catch (err) {
    console.error('[LINE Bot] reply worker error:', err);
    if (Sentry) Sentry.captureException(err);
  } finally {
    replyWorkerRunning = false;
  }
}

function scheduleReply(client: any, payload: any): Promise<any> | void {
  if (!LINE_REPLY_BATCH_ASYNC) {
    // immediate path (preserves existing behaviour)
    recordMetric('attempted');
    return replyWithRetry(client, payload)
      .then((res) => {
        recordMetric('succeeded');
        return res;
      })
      .catch((err) => {
        recordMetric('failed');
        if (Sentry) Sentry.captureException(err);
        throw err;
      });
  }

  // enqueue for asynchronous processing
  replyQueue.push(payload);
  // schedule worker run shortly
  setTimeout(() => {
    processReplyQueue(client).catch((e) => {
      console.error('[LINE Bot] reply worker fatal:', e);
      if (Sentry) Sentry.captureException(e);
    });
  }, REPLY_BATCH_INTERVAL);
}


function getHistory(conversationKey: string): LLMMessage[] {
  if (!userHistory.has(conversationKey)) {
    const persisted = loadHistory(conversationKey);
    const history: LLMMessage[] = persisted.length > 0 ? persisted : [];
    if (history.length === 0 && SYSTEM_PROMPT) {
      history.push({ role: 'system', content: SYSTEM_PROMPT });
    }
    userHistory.set(conversationKey, history);
  }
  return userHistory.get(conversationKey)!;
}

async function persistHistory(conversationKey: string, history: LLMMessage[]): Promise<void> {
  try {
    await saveHistory(conversationKey, history);
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
      await scheduleReply(client, {
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

  const model = resolveModel(provider);

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

    const identity = await resolveConversationKey('line', userId);
    const sessionKey = identity.channelKey;
    const conversationKey = identity.conversationKey;
    const wizSess = getWizardSession(sessionKey);
    const lowerText = userText.toLowerCase();

    // ── Wizard: cancel ──
    if (wizSess && (lowerText === 'キャンセル' || lowerText === 'cancel')) {
      clearWizardSession(sessionKey);
      await scheduleReply(client, {
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
      await scheduleReply(client, {
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
          await scheduleReply(client, {
            replyToken,
            messages: [{ type: 'text', text: truncateMessage(reply) }],
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await scheduleReply(client, {
            replyToken,
            messages: [{ type: 'text', text: `エラーが発生しました: ${errMsg.slice(0, 200)}` }],
          });
        }
      } else {
        await scheduleReply(client, {
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
          await scheduleReply(client, {
            replyToken,
            messages: [{ type: 'text', text: truncateMessage(replyText) }],
          });
        } else {
          await scheduleReply(client, {
            replyToken,
            messages: [{ type: 'text', text: truncateMessage(result.text) }],
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await scheduleReply(client, {
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
      const task = await startTask({
        kind: 'wizard',
        personId: identity.personId,
        channelKey: identity.channelKey,
        conversationKey,
        title: prompt.slice(0, 120),
      });
      try {
        const resp = await withSkillExecutionContext(
          { personId: identity.personId, channelKey: identity.channelKey, taskId: task.id },
          () => adapter.complete({
            messages: [{ role: 'user', content: prompt }],
            timeoutMs,
          }),
        );
        await finishTask(task.id, 'succeeded');
        await scheduleReply(client, {
          replyToken,
          messages: [{ type: 'text', text: truncateMessage(resp.content || '（応答がありませんでした）') }],
        });
      } catch (err) {
        await finishTask(task.id, 'failed', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        await scheduleReply(client, {
          replyToken,
          messages: [{ type: 'text', text: `実行エラー: ${errMsg.slice(0, 200)}` }],
        });
      }
      continue;
    }

    // ── Memory nudge: consume pending nudge if user replied はい/いいえ ──
    try {
      const nudgeResult = await consumePendingNudge(conversationKey, userText);
      if (nudgeResult.consumed) {
        const nudgeReply = nudgeResult.reply ?? '';
        const history = getHistory(conversationKey);
        history.push({ role: 'user', content: userText });
        history.push({ role: 'assistant', content: nudgeReply });
        trimHistory(history);
        await persistHistory(conversationKey, history);
        await scheduleReply(client, {
          replyToken,
          messages: [{ type: 'text', text: truncateMessage(nudgeReply) }],
        });
        continue;
      }
    } catch (nudgeErr) {
      console.warn('[LINE Bot] Memory nudge error:', nudgeErr);
    }

    // ── Normal LLM chat (existing) ──
    const history = getHistory(conversationKey);
    history.push({ role: 'user', content: userText });
    trimHistory(history);

    const task = await startTask({
      kind: 'conversation',
      personId: identity.personId,
      channelKey: identity.channelKey,
      conversationKey,
      title: userText.slice(0, 120),
    });
    try {
      const resp = await withSkillExecutionContext(
        { personId: identity.personId, channelKey: identity.channelKey, taskId: task.id },
        () => adapter.complete({ messages: [...history], timeoutMs }),
      );
      let replyText = resp.content || '（応答がありませんでした）';
      try {
        const nudgeSuffix = maybeCreateNudge(conversationKey, userText);
        if (nudgeSuffix) replyText += nudgeSuffix;
      } catch (nudgeErr) {
        console.warn('[LINE Bot] Memory nudge suffix error:', nudgeErr);
      }
      history.push({ role: 'assistant', content: replyText });
      trimHistory(history);
      await persistHistory(conversationKey, history);
      await finishTask(task.id, 'succeeded');
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: truncateMessage(replyText) }],
      });
    } catch (err) {
      await finishTask(task.id, 'failed', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[LINE Bot] LLM error:', err);
      const idx = history.findLastIndex((m) => m.role === 'user' && m.content === userText);
      if (idx !== -1) history.splice(idx, 1);
      await scheduleReply(client, {
        replyToken,
        messages: [{ type: 'text', text: `エラーが発生しました: ${errMsg.slice(0, 200)}` }],
      });
    }
  }

  return NextResponse.json({ ok: true });
}
