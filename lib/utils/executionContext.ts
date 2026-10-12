import { AsyncLocalStorage } from 'node:async_hooks';

export interface SkillExecutionContext {
  personId?: string;
  channelKey?: string;
  taskId?: string;
  approvalId?: string;
  /** Final policy / approval decision for the current tool call, when known. */
  policyDecision?: string;
  /** Approval resolution for Human-in-the-Loop gated tool calls. */
  approvalStatus?: string;
}

const storage = new AsyncLocalStorage<SkillExecutionContext>();

export function getSkillExecutionContext(): SkillExecutionContext | undefined {
  return storage.getStore();
}

export function updateSkillExecutionContext(update: SkillExecutionContext): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, update);
}

export async function withSkillExecutionContext<T>(
  context: SkillExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ ...context }, fn);
}
