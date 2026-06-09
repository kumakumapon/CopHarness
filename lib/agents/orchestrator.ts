import { createAdapter, resolveProvider, resolveModel } from '../adapterFactory';
import { resolveSkills } from '../skill';
import { getSkillExecutionContext, withSkillExecutionContext } from '../skills/executionContext';
import { finishTask, startTask } from '../tasks/ledger';
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
    process.env.ANTHROPIC_API_KEY ??
    process.env.GEMINI_API_KEY
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
      model,
      provider,
    },
  });

  let adapter: LLMAdapter | undefined;
  const start = Date.now();
  try {
    adapter = createAdapter({ provider, model, apiKey, timeoutMs });
    const skills = task.skills ? resolveSkills(task.skills) : undefined;
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
      }),
    );
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
    await finishTask(taskRecord.id, 'failed', err);
    return {
      taskId: taskRecord.id,
      role: roleName,
      content: '',
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
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
