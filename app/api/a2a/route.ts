/**
 * Agent2Agent (A2A) protocol endpoint.
 * Accepts an agent task and returns the result.
 * Follows the A2A JSON protocol introduced by Google in 2025.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAgentTask } from '../../../lib/agents/orchestrator';
import { requireApiKey } from '../../../lib/apiAuth';
import { defaultRateLimiter, rateLimitResponse, resolveRateLimitKey } from '../../../lib/rateLimit';
import '../../../lib/skills/index';

interface A2ARequest {
  task: {
    id?: string;
    role: string;
    input: string;
    systemPrompt?: string;
    skills?: string[];
    timeoutMs?: number;
    model?: string;
  };
}

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const rl = defaultRateLimiter.consume(resolveRateLimitKey(req));
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: A2ARequest;
  try {
    body = (await req.json()) as A2ARequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { task } = body;
  if (
    typeof task?.role !== 'string' ||
    task.role.length === 0 ||
    typeof task?.input !== 'string' ||
    task.input.length === 0
  ) {
    return NextResponse.json(
      { error: 'task.role and task.input are required' },
      { status: 400 },
    );
  }

  if (
    task.skills !== undefined &&
    (!Array.isArray(task.skills) ||
      !task.skills.every((s) => typeof s === 'string' && s.length > 0))
  ) {
    return NextResponse.json(
      { error: 'task.skills must be an array of non-empty strings' },
      { status: 400 },
    );
  }

  if (task.model !== undefined && typeof task.model !== 'string') {
    return NextResponse.json({ error: 'task.model must be a string' }, { status: 400 });
  }

  if (task.systemPrompt !== undefined && typeof task.systemPrompt !== 'string') {
    return NextResponse.json(
      { error: 'task.systemPrompt must be a string' },
      { status: 400 },
    );
  }

  let timeoutMs: number | undefined;
  if (task.timeoutMs !== undefined) {
    if (typeof task.timeoutMs !== 'number' || !Number.isFinite(task.timeoutMs)) {
      return NextResponse.json(
        { error: 'task.timeoutMs must be a finite number' },
        { status: 400 },
      );
    }
    const defaultTimeout = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
    // Cap user-supplied timeoutMs to the server default to prevent resource exhaustion.
    timeoutMs = Math.min(Math.max(1, task.timeoutMs), defaultTimeout);
  }

  const taskId = task.id ?? crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const result = await runAgentTask({
      id: taskId,
      role: task.systemPrompt
        ? { name: task.role, description: task.role, systemPrompt: task.systemPrompt }
        : task.role,
      userPrompt: task.input,
      skills: task.skills,
      timeoutMs,
      model: task.model,
    });

    return NextResponse.json({
      result: {
        id: result.taskId ?? taskId,
        role: result.role,
        output: result.content,
        status: result.error ? 'failed' : 'completed',
        error: result.error,
        model: result.model,
        provider: result.provider,
        durationMs: result.durationMs,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        result: {
          id: taskId,
          role: task.role,
          output: '',
          status: 'failed',
          error: message,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      },
      { status: 500 },
    );
  }
}
