import { NextRequest } from 'next/server';
import { createAdapterWithFallback, resolveProvider, resolveModel } from '../../../../lib/adapterFactory';
import { resolveSkills, listActiveSkills } from '../../../../lib/skill';
import { requireApiKey } from '../../../../lib/apiAuth';
import { defaultRateLimiter, rateLimitResponse, resolveRateLimitKey } from '../../../../lib/rateLimit';
import { resolveConversationKey } from '../../../../lib/identity/store';
import { withSkillExecutionContext } from '../../../../lib/skills/executionContext';
import { finishTask, startTask } from '../../../../lib/tasks/ledger';
import { registerTaskAbortController, unregisterTaskAbortController } from '../../../../lib/tasks/cancellation';
import { runAgentLoop } from '../../../../lib/agents/agentLoop';
import '../../../../lib/skills/index';

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const rl = defaultRateLimiter.consume(resolveRateLimitKey(req));
  if (!rl.allowed) return rateLimitResponse(rl);

  const provider = resolveProvider();
  const localProviders = ['lmstudio', 'lemonade'];
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ||
    process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !localProviders.includes(provider)) {
    return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });
  }

  let body: {
    goal?: string;
    skills?: string[];
    subject?: string;
    displayName?: string;
    maxIterations?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { goal } = body;
  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'goal string is required' }), { status: 400 });
  }

  const model = resolveModel(provider);
  const defaultTimeout = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const adapter = createAdapterWithFallback({ provider, model, apiKey, timeoutMs: defaultTimeout });
  const skills = Array.isArray(body.skills) ? resolveSkills(body.skills) : listActiveSkills();
  const subject = String(body.subject ?? req.headers.get('x-copharness-subject') ?? 'anonymous').trim() || 'anonymous';
  const identity = await resolveConversationKey('api', subject, { displayName: body.displayName });
  const task = await startTask({
    kind: 'agent',
    personId: identity.personId,
    channelKey: identity.channelKey,
    conversationKey: identity.conversationKey,
    title: goal.slice(0, 120),
    metadata: { stream: true },
  });

  const taskAbort = new AbortController();
  registerTaskAbortController(task.id, taskAbort);
  const abortSignal = req.signal
    ? AbortSignal.any([req.signal, taskAbort.signal])
    : taskAbort.signal;

  const encoder = new TextEncoder();

  function sseEvent(data: unknown): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

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
            const result = await runAgentLoop({
              goal: goal.trim(),
              adapter,
              skills,
              maxIterations: body.maxIterations,
              abortSignal,
              callbacks: {
                onProgress: (message) => {
                  controller.enqueue(sseEvent({ type: 'progress', message }));
                },
                onToolCall: (skill, args) => {
                  controller.enqueue(sseEvent({ type: 'tool_call', skill, args }));
                },
                onToolResult: (skill, result, isError) => {
                  controller.enqueue(sseEvent({ type: 'tool_result', skill, result, isError }));
                },
                onResponse: (content) => {
                  controller.enqueue(sseEvent({ type: 'response', content }));
                },
                onCompaction: (before, after) => {
                  controller.enqueue(sseEvent({ type: 'compaction', before, after }));
                },
                onRequestInput: undefined,
              },
            });

            controller.enqueue(
              sseEvent({
                type: 'done',
                result: {
                  completed: result.completed,
                  iterations: result.iterations,
                  durationMs: result.durationMs,
                  toolCallCount: result.toolCallCount,
                  summary: result.summary,
                },
              }),
            );
          },
        );
        await finishTask(task.id, 'succeeded');
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        if (taskAbort.signal.aborted) {
          controller.enqueue(
            sseEvent({ type: 'error', message: 'Task cancelled', taskId: task.id }),
          );
        } else {
          const message = err instanceof Error ? err.message : String(err);
          await finishTask(task.id, 'failed', err);
          controller.enqueue(sseEvent({ type: 'error', message, taskId: task.id }));
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
