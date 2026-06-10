import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getSkillExecutionContext } from '../skills/executionContext';
import { finishTask, startTask, updateTaskMetadata } from '../tasks/ledger';
import { dataPath } from '../utils/dataDir';
import { runAgentTask } from './orchestrator';
import type {
  AgentDagNodeResult,
  AgentDagRunResult,
  AgentPlan,
  AgentPlanProgress,
  AgentResult,
  AgentTask,
} from './types';

export type AgentPlanRunner = (task: AgentTask, plan: AgentPlan) => Promise<AgentResult>;

function assertValidDag(plans: AgentPlan[]): void {
  const ids = new Set<string>();
  for (const plan of plans) {
    if (!plan.id.trim()) throw new Error('AgentPlan id must be non-empty');
    if (ids.has(plan.id)) throw new Error(`Duplicate AgentPlan id: ${plan.id}`);
    ids.add(plan.id);
  }

  for (const plan of plans) {
    for (const dep of plan.dependsOn ?? []) {
      if (!ids.has(dep)) throw new Error(`AgentPlan ${plan.id} depends on unknown node: ${dep}`);
      if (dep === plan.id) throw new Error(`AgentPlan ${plan.id} cannot depend on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plans.map((plan) => [plan.id, plan]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`AgentPlan DAG contains a cycle at node: ${id}`);
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }

  for (const plan of plans) visit(plan.id);
}

function dependencySummary(results: Map<string, AgentDagNodeResult>, plan: AgentPlan): string {
  const deps = plan.dependsOn ?? [];
  if (deps.length === 0) return '';
  const sections = deps.map((dep) => {
    const result = results.get(dep);
    const content = result?.result?.content ?? '';
    const error = result?.error ?? result?.result?.error;
    return [
      `Dependency ${dep} (${result?.status ?? 'unknown'}):`,
      error ? `Error: ${error}` : content,
    ].join('\n');
  });
  return `\n\nDependency results:\n${sections.join('\n\n')}`;
}

function planWorkspace(runId: string, plan: AgentPlan): string {
  if (plan.workspace?.trim()) return path.resolve(plan.workspace);
  return dataPath(path.join('agent_workspaces', runId, plan.id));
}

function progressFromResult(result: AgentDagNodeResult): AgentPlanProgress {
  return {
    planId: result.planId,
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    error: result.error ?? result.result?.error,
  };
}

function roleName(role: AgentPlan['role']): string {
  return typeof role === 'string' ? role : role.name;
}

function initialProgress(plans: AgentPlan[]): AgentPlanProgress[] {
  return plans.map((plan) => ({ planId: plan.id, status: 'pending' }));
}

function progressSnapshot(
  plans: AgentPlan[],
  results: Map<string, AgentDagNodeResult>,
  running = new Set<string>(),
): AgentPlanProgress[] {
  return plans.map((plan) => {
    const result = results.get(plan.id);
    if (result) return progressFromResult(result);
    return { planId: plan.id, status: running.has(plan.id) ? 'running' : 'pending' };
  });
}

async function recordDagProgress(
  taskId: string,
  runId: string,
  plans: AgentPlan[],
  results: Map<string, AgentDagNodeResult>,
  status: 'running' | 'succeeded' | 'failed',
  running = new Set<string>(),
): Promise<void> {
  await updateTaskMetadata(taskId, {
    agentDag: {
      runId,
      status,
      plans: plans.map((plan) => ({
        id: plan.id,
        role: roleName(plan.role),
        dependsOn: plan.dependsOn ?? [],
        skills: plan.skills ?? [],
        timeoutMs: plan.timeoutMs,
        budget: plan.budget,
        workspace: planWorkspace(runId, plan),
      })),
      progress: progressSnapshot(plans, results, running),
      results: plans
        .map((plan) => results.get(plan.id))
        .filter((result): result is AgentDagNodeResult => Boolean(result)),
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function runAgentDag(
  plans: AgentPlan[],
  options: {
    runId?: string;
    title?: string;
    runner?: AgentPlanRunner;
  } = {},
): Promise<AgentDagRunResult> {
  assertValidDag(plans);
  const runId = options.runId?.trim() || `agent_run_${randomUUID()}`;
  const start = Date.now();
  const inheritedContext = getSkillExecutionContext();
  const parentTask = await startTask({
    kind: 'agent',
    personId: inheritedContext?.personId,
    channelKey: inheritedContext?.channelKey,
    title: options.title ?? `Agent DAG ${runId}`,
    metadata: {
      runId,
      planIds: plans.map((plan) => plan.id),
      mode: 'dag',
      agentDag: {
        runId,
        status: 'running',
        plans: plans.map((plan) => ({
          id: plan.id,
          role: roleName(plan.role),
          dependsOn: plan.dependsOn ?? [],
          skills: plan.skills ?? [],
          timeoutMs: plan.timeoutMs,
          budget: plan.budget,
          workspace: planWorkspace(runId, plan),
        })),
        progress: initialProgress(plans),
        results: [],
        updatedAt: new Date().toISOString(),
      },
    },
  });

  const pending = new Map(plans.map((plan) => [plan.id, plan]));
  const results = new Map<string, AgentDagNodeResult>();
  const runner = options.runner ?? runAgentTask;

  try {
    while (pending.size > 0) {
      const skipped = Array.from(pending.values()).filter((plan) =>
        (plan.dependsOn ?? []).some((dep) => {
          const depResult = results.get(dep);
          return depResult?.status === 'failed' || depResult?.status === 'skipped';
        }),
      );

      for (const plan of skipped) {
        const completedAt = new Date().toISOString();
        results.set(plan.id, {
          planId: plan.id,
          status: 'skipped',
          error: 'Skipped because a dependency failed or was skipped',
          completedAt,
          workspace: planWorkspace(runId, plan),
        });
        pending.delete(plan.id);
      }
      if (skipped.length > 0) {
        await recordDagProgress(parentTask.id, runId, plans, results, 'running');
      }

      if (pending.size === 0) break;

      const ready = Array.from(pending.values()).filter((plan) =>
        (plan.dependsOn ?? []).every((dep) => results.get(dep)?.status === 'succeeded'),
      );

      if (ready.length === 0) {
        throw new Error('AgentPlan DAG made no progress; this indicates an invalid dependency graph');
      }

      await recordDagProgress(parentTask.id, runId, plans, results, 'running', new Set(ready.map((plan) => plan.id)));

      const settled = await Promise.allSettled(
        ready.map(async (plan) => {
          const workspace = planWorkspace(runId, plan);
          fs.mkdirSync(workspace, { recursive: true });
          const startedAt = new Date().toISOString();
          const result = await runner({
            id: `${runId}_${plan.id}`,
            role: plan.role,
            userPrompt: `${plan.prompt}${dependencySummary(results, plan)}`,
            skills: plan.skills,
            timeoutMs: plan.timeoutMs,
            parentTaskId: parentTask.id,
            workspace,
          }, plan);
          const completedAt = new Date().toISOString();
          return {
            planId: plan.id,
            status: result.error ? 'failed' : 'succeeded',
            result,
            error: result.error,
            workspace,
            startedAt,
            completedAt,
          } satisfies AgentDagNodeResult;
        }),
      );

      ready.forEach((plan, index) => {
        const entry = settled[index];
        pending.delete(plan.id);
        if (entry.status === 'fulfilled') {
          results.set(plan.id, entry.value);
          return;
        }
        const completedAt = new Date().toISOString();
        const error = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
        results.set(plan.id, {
          planId: plan.id,
          status: 'failed',
          error,
          workspace: planWorkspace(runId, plan),
          completedAt,
        });
      });
      await recordDagProgress(parentTask.id, runId, plans, results, 'running');
    }

    const orderedResults = plans.map((plan) => results.get(plan.id)!);
    const failed = orderedResults.some((result) => result.status === 'failed');
    await recordDagProgress(parentTask.id, runId, plans, results, failed ? 'failed' : 'succeeded');
    await finishTask(parentTask.id, failed ? 'failed' : 'succeeded');
    return {
      runId,
      taskId: parentTask.id,
      status: failed ? 'failed' : 'succeeded',
      progress: orderedResults.map(progressFromResult),
      results: orderedResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    await finishTask(parentTask.id, 'failed', err);
    throw err;
  }
}
