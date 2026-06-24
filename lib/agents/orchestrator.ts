import { createAdapter, resolveProvider, resolveModel } from '../adapterFactory';
import { resolveSkills } from '../skill';
import { resolveToolsetSkillNames } from '../skills/toolsets';
import { getSkillExecutionContext, withSkillExecutionContext } from '../skills/executionContext';
import { finishTask, startTask } from '../tasks/ledger';
import { registerTaskAbortController, unregisterTaskAbortController } from '../tasks/cancellation';
import { runAgentLoop } from './agentLoop';
import { eventBus } from '../events/bus';
import type { LLMAdapter } from '../adapter';
import type { AgentTask, AgentResult } from './types';

export const BUILT_IN_ROLE_PROMPTS: Record<string, string> = {
  researcher:
    'あなたは情報収集の専門家です。与えられたトピックについて徹底的に調査し、事実に基づいた詳細なレポートを提供します。',
  coder:
    'あなたは熟練したソフトウェアエンジニアです。クリーンで効率的なコードを書き、技術的な問題を解決します。',
  reviewer:
    'あなたは経験豊富なコードレビュアーです。コードの問題点を指摘し、改善提案を行います。',
  summarizer:
    'あなたは優秀なライターです。複雑な情報を簡潔にまとめ、読みやすい要約を作成します。',
  planner:
    'あなたは戦略的思考を持つプランナーです。目標達成のための詳細な計画を立案します。',
};

function resolveSystemPrompt(role: AgentTask['role']): { name: string; systemPrompt: string } {
  if (typeof role === 'string') {
    return {
      name: role,
      systemPrompt: BUILT_IN_ROLE_PROMPTS[role] ?? `あなたは${role}として行動します。`,
    };
  }
  return { name: role.name, systemPrompt: role.systemPrompt };
}

function resolveApiKey(): string | undefined {
  return (
    process.env.COPILOT_PROVIDER_API_KEY ??
    process.env.COPILOT_API_KEY ??
    process.env.GITHUB_COPILOT_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY
  );
}

export async function runAgentTask(task: AgentTask): Promise<AgentResult> {
  const { name: roleName, systemPrompt } = resolveSystemPrompt(task.role);
  const provider = resolveProvider();
  const model =
    task.model ??
    resolveModel(provider);
  const apiKey = resolveApiKey();
  const timeoutMs =
    task.timeoutMs ?? (Number(process.env.COPILOT_TIMEOUT_MS) || 120_000);
  const inheritedContext = getSkillExecutionContext();
  const taskRecord = await startTask({
    id: task.id,
    kind: 'agent',
    personId: task.personId ?? inheritedContext?.personId,
    channelKey: task.channelKey ?? inheritedContext?.channelKey,
    conversationKey: task.conversationKey,
    title: `${roleName}: ${task.userPrompt.slice(0, 100)}`,
    metadata: {
      role: roleName,
      parentTaskId: task.parentTaskId ?? inheritedContext?.taskId,
      requestedSkills: task.skills,
      workspace: task.workspace,
      model,
      provider,
    },
  });

  let adapter: LLMAdapter | undefined;
  const start = Date.now();
  const abortController = new AbortController();
  registerTaskAbortController(taskRecord.id, abortController);
  try {
    adapter = createAdapter({ provider, model, apiKey, timeoutMs });
    const toolsetSkillNames = task.toolsets && task.toolsets.length > 0
      ? resolveToolsetSkillNames(task.toolsets)
      : [];
    const allSkillNames = [
      ...(task.skills ?? []),
      ...toolsetSkillNames,
    ];
    const dedupedSkillNames = Array.from(new Set(allSkillNames));
    const skills = dedupedSkillNames.length > 0 ? resolveSkills(dedupedSkillNames) : undefined;

    eventBus.emit('agent:start', {
      taskId: taskRecord.id,
      role: roleName,
      goal: task.userPrompt.slice(0, 200),
    });

    if (task.useAgentLoop) {
      const loopResult = await withSkillExecutionContext(
        {
          ...inheritedContext,
          personId: taskRecord.personId,
          channelKey: taskRecord.channelKey,
          taskId: taskRecord.id,
        },
        () => runAgentLoop({
          goal: task.userPrompt,
          adapter: adapter!,
          skills: skills ?? [],
          systemPrompt,
          maxIterations: task.maxIterations ?? (Number(process.env.AGENT_MAX_ITERATIONS) || 25),
          timeoutMs,
          abortSignal: abortController.signal,
          callbacks: {
            onProgress(message) {
              eventBus.emit('agent:progress', {
                taskId: taskRecord.id,
                iteration: 0,
                message,
              });
            },
          },
        }),
      );

      eventBus.emit('agent:complete', {
        taskId: taskRecord.id,
        role: roleName,
        durationMs: loopResult.durationMs,
        iterations: loopResult.iterations,
        toolCallCount: loopResult.toolCallCount,
        completed: loopResult.completed,
      });

      await finishTask(taskRecord.id, 'succeeded');
      return {
        taskId: taskRecord.id,
        role: roleName,
        content: loopResult.summary ?? loopResult.content,
        model,
        provider,
        durationMs: Date.now() - start,
        error: loopResult.completed ? undefined : 'Agent loop did not complete',
      };
    }

    const resp = await withSkillExecutionContext(
      {
        ...inheritedContext,
        personId: taskRecord.personId,
        channelKey: taskRecord.channelKey,
        taskId: taskRecord.id,
      },
      () => adapter!.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: task.userPrompt },
        ],
        skills,
        timeoutMs,
        abortSignal: abortController.signal,
      }),
    );

    eventBus.emit('agent:complete', {
      taskId: taskRecord.id,
      role: roleName,
      durationMs: Date.now() - start,
      iterations: 1,
      toolCallCount: 0,
      completed: true,
    });

    await finishTask(taskRecord.id, 'succeeded');
    return {
      taskId: taskRecord.id,
      role: roleName,
      content: resp.content,
      model: resp.model,
      provider: resp.provider,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const cancelled = abortController.signal.aborted;
    const errMsg = cancelled ? 'cancelled' : err instanceof Error ? err.message : String(err);
    eventBus.emit('agent:error', {
      taskId: taskRecord.id,
      role: roleName,
      error: errMsg,
      durationMs: Date.now() - start,
    });
    if (!cancelled) await finishTask(taskRecord.id, 'failed', err);
    return {
      taskId: taskRecord.id,
      role: roleName,
      content: '',
      durationMs: Date.now() - start,
      error: errMsg,
    };
  } finally {
    unregisterTaskAbortController(taskRecord.id);
    await Promise.resolve(adapter?.destroy?.()).catch(() => {});
  }
}

export async function runAgentPipeline(tasks: AgentTask[]): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  for (const task of tasks) {
    results.push(await runAgentTask(task));
  }
  return results;
}
