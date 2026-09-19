import { NextRequest } from 'next/server';
import { createAdapterWithFallback, resolveRuntimeConfig } from '../../../../lib/adapterFactory';
import { resolveSkills, listActiveSkills } from '../../../../lib/skill';
import { requireApiKey } from '../../../../lib/apiAuth';
import { defaultRateLimiter, rateLimitResponse, resolveRateLimitKey } from '../../../../lib/rateLimit';
import { resolveConversationKey } from '../../../../lib/identity/store';
import { withSkillExecutionContext } from '../../../../lib/skills/executionContext';
import { finishTask, startTask, updateTaskMetadata } from '../../../../lib/tasks/ledger';
import { registerTaskAbortController, unregisterTaskAbortController } from '../../../../lib/tasks/cancellation';
import { acquireAgentSession, loadAgentSession, newAgentSessionId, runAgentSession, SessionError, validateResume } from '../../../../lib/agents/sessions';
import { getExecutionBackend } from '../../../../lib/execution';
import '../../../../lib/skills/index';

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;
  const rl = defaultRateLimiter.consume(resolveRateLimitKey(req));
  if (!rl.allowed) return rateLimitResponse(rl);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { goal, sessionId, answer, maxIterations, skills: requestedSkills, subject: requestedSubject, displayName } = body;
  if ((sessionId !== undefined && typeof sessionId !== 'string') ||
      (!sessionId && (typeof goal !== 'string' || !goal.trim())) ||
      (goal !== undefined && typeof goal !== 'string') ||
      (answer !== undefined && typeof answer !== 'string') ||
      (requestedSubject !== undefined && typeof requestedSubject !== 'string') ||
      (displayName !== undefined && typeof displayName !== 'string') ||
      (requestedSkills !== undefined && (!Array.isArray(requestedSkills) || !requestedSkills.every(s => typeof s === 'string'))) ||
      (maxIterations !== undefined && (!Number.isInteger(maxIterations) || Number(maxIterations) < 1 || Number(maxIterations) > 1000))) {
    return Response.json({ error: 'Invalid agent request: provide goal or sessionId; maxIterations must be 1–1000' }, { status: 400 });
  }
  const config = resolveRuntimeConfig();
  if (!config.configured) return Response.json({ error: 'Missing provider API key. Run npm run doctor.' }, { status: 401 });
  const subject = String(requestedSubject ?? req.headers.get('x-copharness-subject') ?? 'anonymous').trim() || 'anonymous';
  const owner = `api:${subject}`;
  const id = typeof sessionId === 'string' && sessionId ? sessionId : newAgentSessionId();
  let release: (() => void) | undefined;
  let adapter: ReturnType<typeof createAdapterWithFallback> | undefined;
  try {
    getExecutionBackend();
    release = acquireAgentSession(id);
    const saved = sessionId ? loadAgentSession(id) : undefined;
    if (sessionId && !saved) throw new SessionError('Session not found', 404);
    if (saved) validateResume(saved, owner, answer as string | undefined);
    const taskGoal = saved?.goal ?? (goal as string).trim();
    const identity = await resolveConversationKey('api', subject, { displayName: displayName as string | undefined });
    adapter = createAdapterWithFallback(config);
    const activeAdapter = adapter;
    const task = await startTask({ id, kind: 'agent', personId: identity.personId,
      channelKey: identity.channelKey, conversationKey: identity.conversationKey,
      title: taskGoal.slice(0, 120), metadata: { stream: true, sessionId: id } });
    const taskAbort = new AbortController();
    registerTaskAbortController(id, taskAbort);
    const abortSignal = AbortSignal.any([req.signal, taskAbort.signal]);
    const encoder = new TextEncoder();
    const unlock = release;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          if (abortSignal.aborted) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
          catch { taskAbort.abort(); }
        };
        try {
          send({ type: 'started', taskId: id, sessionId: id });
          const result = await withSkillExecutionContext({ personId: identity.personId, channelKey: identity.channelKey, taskId: task.id },
            () => runAgentSession({ goal: taskGoal, adapter: activeAdapter, sessionId: id, owner, resume: Boolean(sessionId),
              answer: answer as string | undefined, skills: Array.isArray(requestedSkills) ? resolveSkills(requestedSkills) : listActiveSkills(),
              maxIterations: maxIterations as number | undefined, abortSignal,
              callbacks: {
                onProgress: message => send({ type: 'progress', message }),
                onToolCall: (skill, args) => send({ type: 'tool_call', skill, args }),
                onToolResult: (skill, result, isError) => send({ type: 'tool_result', skill, result, isError }),
                onResponse: content => send({ type: 'response', content }),
                onCompaction: (before, after) => send({ type: 'compaction', before, after }),
              },
            }));
          await updateTaskMetadata(id, { sessionId: id, stopReason: result.stopReason, pendingQuestion: result.pendingQuestion,
            summary: result.summary, iterations: result.iterations, toolCallCount: result.toolCallCount });
          await finishTask(id, result.stopReason, result.error);
          if (result.pendingQuestion) send({ type: 'input_required', taskId: id, sessionId: id, question: result.pendingQuestion });
          const { messages: _messages, ...publicResult } = result;
          send({ type: 'done', taskId: id, sessionId: id, result: publicResult });
          if (!abortSignal.aborted) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          const cancelled = abortSignal.aborted;
          await finishTask(id, cancelled ? 'cancelled' : 'failed', err);
          send({ type: 'error', taskId: id, sessionId: id, message: cancelled ? 'Task cancelled' : err instanceof Error ? err.message : String(err) });
        } finally {
          unregisterTaskAbortController(id);
          unlock();
          try { await activeAdapter.destroy?.(); } finally { try { controller.close(); } catch { /* disconnected */ } }
        }
      },
      cancel() { taskAbort.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Task-Id': id } });
  } catch (err) {
    release?.();
    await adapter?.destroy?.();
    return Response.json({ error: err instanceof SessionError ? err.message : 'Agent configuration or storage failed. Run npm run doctor.' }, { status: err instanceof SessionError ? err.status : 500 });
  }
}
