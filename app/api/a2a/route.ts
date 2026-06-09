/**
 * Agent2Agent (A2A) protocol endpoint.
 * Accepts an agent task and returns the result.
 * Follows the A2A JSON protocol introduced by Google in 2025.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAgentTask } from '../../../lib/agents/orchestrator';
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
  let body: A2ARequest;
  try {
    body = (await req.json()) as A2ARequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { task } = body;
  if (!task?.role || !task?.input) {
    return NextResponse.json(
      { error: 'task.role and task.input are required' },
      { status: 400 },
    );
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
      timeoutMs: task.timeoutMs,
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
