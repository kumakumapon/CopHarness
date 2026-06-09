export interface AgentRole {
  name: string;
  description: string;
  systemPrompt: string;
}

export interface AgentTask {
  /** Optional external task identifier to adopt in TaskLedger. */
  id?: string;
  role: AgentRole | string;
  userPrompt: string;
  skills?: string[];
  timeoutMs?: number;
  model?: string;
  /** Optional caller identity context for TaskLedger and nested skill logs. */
  personId?: string;
  channelKey?: string;
  conversationKey?: string;
  /** Parent TaskLedger id when this task is a sub-agent spawned by another run. */
  parentTaskId?: string;
}

/**
 * Declarative node used by the upcoming DAG/parallel agent runner.
 *
 * The existing orchestrator can continue to consume AgentTask, while planners
 * and dashboards can start emitting AgentPlan nodes with explicit dependency,
 * workspace, and budget metadata.
 */
export interface AgentPlan {
  id: string;
  role: AgentRole | string;
  prompt: string;
  dependsOn?: string[];
  skills?: string[];
  timeoutMs?: number;
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
  };
  workspace?: string;
}

export type AgentPlanStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface AgentPlanProgress {
  planId: string;
  status: AgentPlanStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface AgentResult {
  /** TaskLedger id assigned to this agent execution. */
  taskId?: string;
  role: string;
  content: string;
  model?: string;
  provider?: string;
  durationMs: number;
  error?: string;
}
