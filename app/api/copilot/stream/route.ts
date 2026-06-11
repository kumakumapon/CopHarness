import { NextRequest } from 'next/server';
import { createAdapter, resolveProvider, resolveModel } from '../../../../lib/adapterFactory';
import { type LLMMessage, type LLMAttachment } from '../../../../lib/adapter';
import { resolveSkills, listActiveSkills } from '../../../../lib/skill';
import { requireApiKey } from '../../../../lib/apiAuth';
import { resolveConversationKey } from '../../../../lib/identity/store';
import { withSkillExecutionContext } from '../../../../lib/skills/executionContext';
import { finishTask, startTask } from '../../../../lib/tasks/ledger';
import { registerTaskAbortController, unregisterTaskAbortController } from '../../../../lib/tasks/cancellation';
import '../../../../lib/skills/index';

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

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
    return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });
  }

  let body: {
    messages?: LLMMessage[];
    attachments?: LLMAttachment[];
    timeoutMs?: number;
    skills?: string[];
    subject?: string;
    displayName?: string;
    taskId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { messages, attachments } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages array is required' }), {
      status: 400,
    });
  }

  const model = resolveModel(provider);
  const defaultTimeout = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const timeoutMs =
    body.timeoutMs != null
      ? Math.min(Math.max(1, body.timeoutMs), defaultTimeout)
      : defaultTimeout;

  const adapter = createAdapter({ provider, model, apiKey, timeoutMs });
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
    metadata: { stream: true },
  });

  const taskAbort = new AbortController();
  registerTaskAbortController(task.id, taskAbort);
  const abortSignal = req.signal
    ? AbortSignal.any([req.signal, taskAbort.signal])
    : taskAbort.signal;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await withSkillExecutionContext(
          {
            personId: identity.personId,
            channelKey: identity.channelKey,
            taskId: task.id,
          },
          async () => {
            const gen = adapter.stream
              ? adapter.stream({ messages, attachments, timeoutMs, abortSignal, skills })
              : (async function* fallback() {
                  const resp = await adapter.complete({
                    messages,
                    attachments,
                    timeoutMs,
                    abortSignal,
                    skills,
                  });
                  yield resp.content;
                })();

            for await (const chunk of gen) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`),
              );
            }
          },
        );
        await finishTask(task.id, 'succeeded');
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        // A stop request via the cancellation registry has already finished
        // the ledger entry as cancelled; report the cancellation downstream.
        if (taskAbort.signal.aborted) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Task cancelled', taskId: task.id })}\n\n`),
          );
        } else {
          const message = err instanceof Error ? err.message : String(err);
          await finishTask(task.id, 'failed', err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message, taskId: task.id })}\n\n`),
          );
        }
      } finally {
        unregisterTaskAbortController(task.id);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
