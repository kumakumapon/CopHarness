import { NextRequest, NextResponse } from 'next/server';
import { createAdapterWithFallback, resolveModel, resolveProvider } from '../../../lib/adapterFactory';
import { type LLMMessage } from '../../../lib/adapter';
import { normalizeSlackEvent, type SlackEventEnvelope, validateSlackSignature } from '../../../lib/channels/slack';
import { executeAgentCommand, parseAgentCommand } from '../../../lib/channels/agentCommands';
import { resolveConversationKey } from '../../../lib/identity/store';
import { loadHistory, saveHistory } from '../../../lib/history/store';
import { trimHistoryToTokenBudget } from '../../../lib/history/trimmer';
import { withSkillExecutionContext } from '../../../lib/skills/executionContext';
import { startTask, finishTask } from '../../../lib/tasks/ledger';
import { runWithRalphLoop } from '../../../lib/context/ralphLoop';

const MAX_HISTORY = Math.max(1, Number(process.env.SLACK_MAX_HISTORY) || 20);
const MAX_MESSAGE_LENGTH = 3900;
const SYSTEM_PROMPT = process.env.COPILOT_SYSTEM_PROMPT ?? '';

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? text.slice(0, MAX_MESSAGE_LENGTH) : text;
}

async function postMessage(channel: string, text: string, threadTs?: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text: truncate(text), ...(threadTs ? { thread_ts: threadTs } : {}) }),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(`Slack chat.postMessage failed: ${result.error ?? response.status}`);
}

function getHistory(key: string): LLMMessage[] {
  const existing = loadHistory(key);
  if (existing.length > 0) return existing;
  return SYSTEM_PROMPT ? [{ role: 'system', content: SYSTEM_PROMPT }] : [];
}

export async function POST(req: NextRequest) {
  const secret = process.env.SLACK_SIGNING_SECRET ?? '';
  if (!secret || !process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json({ error: 'Slack credentials not configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!validateSlackSignature(rawBody, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid Slack signature' }, { status: 401 });
  }

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event = normalizeSlackEvent(payload);
  if (event.type === 'url_verification') return NextResponse.json({ challenge: event.challenge ?? '' });
  if (!event.shouldRespond || !event.userId || !event.channelId || !event.text) return NextResponse.json({ ok: true });

  const identity = await resolveConversationKey('slack', event.userId);
  const conversationKey = event.threadKey ?? identity.conversationKey;
  const text = event.text.replace(/<@[^>]+>\s*/g, '').trim();
  if (!text) return NextResponse.json({ ok: true });

  const command = parseAgentCommand(text);
  if (command) {
    const reply = await executeAgentCommand(command, { personId: identity.personId, channelKey: identity.channelKey });
    await postMessage(event.channelId, reply, event.threadKey?.split(':').at(-1));
    return NextResponse.json({ ok: true });
  }

  const provider = resolveProvider();
  const localProviders = ['lmstudio', 'lemonade'];
  const apiKey = process.env.COPILOT_PROVIDER_API_KEY || process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !localProviders.includes(provider)) return NextResponse.json({ error: 'LLM credentials not configured' }, { status: 503 });

  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const adapter = createAdapterWithFallback({ provider, model: resolveModel(provider), apiKey, timeoutMs });
  const history = getHistory(conversationKey);
  history.push({ role: 'user', content: text });
  trimHistoryToTokenBudget(history, undefined, undefined, MAX_HISTORY * 2);

  const task = await startTask({
    kind: 'conversation',
    personId: identity.personId,
    channelKey: identity.channelKey,
    conversationKey,
    title: text.slice(0, 120),
  });
  try {
    const response = await withSkillExecutionContext(
      { personId: identity.personId, channelKey: identity.channelKey, taskId: task.id },
      () => runWithRalphLoop({ messages: [...history], timeoutMs }, adapter, { taskId: task.id }),
    );
    const reply = response.content || '（応答がありませんでした）';
    history.push({ role: 'assistant', content: reply });
    trimHistoryToTokenBudget(history, undefined, undefined, MAX_HISTORY * 2);
    await saveHistory(conversationKey, history);
    await finishTask(task.id, 'succeeded');
    await postMessage(event.channelId, reply, event.threadKey?.split(':').at(-1));
  } catch (error) {
    await finishTask(task.id, 'failed', error);
    console.error('[Slack Bot] event handling failed:', error);
    await postMessage(event.channelId, 'エラーが発生しました。しばらくしてから再試行してください。', event.threadKey?.split(':').at(-1));
  }
  return NextResponse.json({ ok: true });
}
