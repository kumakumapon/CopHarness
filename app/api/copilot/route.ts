import { NextRequest, NextResponse } from 'next/server'
import { createAdapter, resolveProvider, resolveModel } from '../../../lib/adapterFactory';
import { type LLMMessage, type LLMAttachment } from '../../../lib/adapter';
import { resolveSkills, listActiveSkills } from '../../../lib/skill';
import { requireApiKey } from '../../../lib/apiAuth';
import { resolveConversationKey } from '../../../lib/identity/store';
import { withSkillExecutionContext } from '../../../lib/skills/executionContext';
import { finishTask, startTask } from '../../../lib/tasks/ledger';
import { registerTaskAbortController, unregisterTaskAbortController } from '../../../lib/tasks/cancellation';
import { runWithRalphLoop } from '../../../lib/context/ralphLoop';
import '../../../lib/skills/index';


export async function POST(req: NextRequest) {
  // Optional cross-service API key authentication (e.g. from CopChat)
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  // プロバイダ自動判定
  const provider = resolveProvider();
  // Copilot, OpenAI, Anthropic などで環境変数名が異なるため柔軟に取得
  const localProviders = ['lmstudio', 'lemonade'];
  const apiKey = process.env.COPILOT_PROVIDER_API_KEY || process.env.COPILOT_API_KEY || process.env.GITHUB_COPILOT_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey && !localProviders.includes(provider)) {
    return NextResponse.json(
      { error: 'Missing API key (COPILOT_PROVIDER_API_KEY, OPENAI_API_KEY, etc)' },
      { status: 401 }
    );
  }

  let body: { messages?: LLMMessage[]; attachments?: LLMAttachment[]; timeoutMs?: number; skills?: string[]; subject?: string; displayName?: string; taskId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { messages, attachments } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: 'messages array is required and must not be empty' },
      { status: 400 }
    );
  }

  try {
    // モデル名は環境変数またはデフォルト
    const model = resolveModel(provider);
    const defaultTimeout = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
    // Cap user-supplied timeoutMs to the server default to prevent resource exhaustion.
    const timeoutMs =
      body.timeoutMs != null
        ? Math.min(Math.max(1, body.timeoutMs), defaultTimeout)
        : defaultTimeout;
    const adapter = createAdapter({
      provider,
      model,
      apiKey,
      timeoutMs,
    });
    const skills = Array.isArray(body.skills) ? resolveSkills(body.skills) : listActiveSkills();
    const subject = String(body.subject ?? req.headers.get('x-copharness-subject') ?? 'anonymous').trim() || 'anonymous';
    const identity = await resolveConversationKey('api', subject, { displayName: body.displayName });
    const task = await startTask({
      id: body.taskId,
      kind: 'api',
      personId: identity.personId,
      channelKey: identity.channelKey,
      conversationKey: identity.conversationKey,
      title: messages[messages.length - 1]?.content?.slice(0, 120),
    });
    const taskAbort = new AbortController();
    registerTaskAbortController(task.id, taskAbort);
    const abortSignal = req.signal
      ? AbortSignal.any([req.signal, taskAbort.signal])
      : taskAbort.signal;
    try {
      const resp = await withSkillExecutionContext(
        {
          personId: identity.personId,
          channelKey: identity.channelKey,
          taskId: task.id,
        },
        () => runWithRalphLoop({ messages, attachments, timeoutMs, abortSignal, skills }, adapter, { taskId: task.id }),
      );
      await finishTask(task.id, 'succeeded');
      return NextResponse.json({ reply: resp.content, taskId: task.id });
    } catch (err) {
      // A stop request via the cancellation registry has already finished the
      // ledger entry as cancelled; report the cancellation instead of failing.
      if (taskAbort.signal.aborted) {
        return NextResponse.json({ error: 'Task cancelled', taskId: task.id }, { status: 499 });
      }
      await finishTask(task.id, 'failed', err);
      throw err;
    } finally {
      unregisterTaskAbortController(task.id);
    }
  } catch (err: unknown) {
    console.error('LLM API handler error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.toLowerCase().includes('timeout') ||
      message.includes('ETIMEDOUT') ||
      message.toLowerCase().includes('timed out');
    const isAuthError =
      message.toLowerCase().includes('failed to obtain copilot session token') ||
      message.includes('401') ||
      message.includes('403');
    if (isTimeout) {
      return NextResponse.json(
        { error: 'LLM API timed out', details: message },
        { status: 504 }
      );
    }
    if (isAuthError) {
      const status = message.includes('403') ? 403 : 401;
      return NextResponse.json(
        { error: 'LLM authentication failed. Check API key or token type.', details: message },
        { status }
      );
    }
    return NextResponse.json(
      { error: 'LLM API error', details: message },
      { status: 502 }
    );
  }
}
