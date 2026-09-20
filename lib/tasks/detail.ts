import { getTask } from './ledger';
import { loadAgentSession } from '../agents/sessions';
import { listSkillExecutions } from '../skills/executionLog';
import { listApprovalRequests } from '../humanInLoop/store';
import { redactPreviewText, redactPreviewValue } from '../toolPolicy/redaction';

function preview(value: unknown): string {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? redactPreviewText(value) : JSON.stringify(redactPreviewValue(value));
  return text.length > 8000 ? text.slice(0, 8000) + '\n… (preview truncated)' : text;
}

/** Read-only operator view. Never return raw checkpoints or infer artifact URLs. */
export function getTaskDetail(id: string) {
  const task = getTask(id);
  if (!task) return undefined;
  let session;
  let checkpointWarning: string | undefined;
  if (task.kind === 'agent' && task.metadata?.sessionId === id) {
    try {
      session = loadAgentSession(id);
      if (!session) checkpointWarning = '保存されたセッションが見つかりません。';
    } catch { checkpointWarning = '保存されたセッションを読み込めません。'; }
  }
  // taskQuery is a substring search; correlate with exact IDs before exposing records.
  const executions = listSkillExecutions({ limit: 500, taskQuery: id }).filter(e => e.taskId === id);
  const approvalIds = new Set(executions.map(e => e.approvalId).filter(Boolean));
  const approvals = listApprovalRequests().filter(a => a.taskId === id || approvalIds.has(a.id)).map(a => ({
    id: a.id, skillName: a.skillName, status: a.status as string, createdAt: a.createdAt,
    argsPreview: preview(a.args), preview: preview(a.preview),
  }));
  for (const e of executions) {
    if (e.approvalId && !approvals.some(a => a.id === e.approvalId)) {
      approvals.push({ id: e.approvalId, skillName: e.skillName, status: e.approvalStatus ?? 'unavailable',
        createdAt: Date.parse(e.startedAt), argsPreview: preview(e.argsPreview), preview: '' });
    }
  }
  return {
    id, status: task.status, checkpointStatus: session?.status, checkpointWarning,
    input: preview(session?.goal ?? task.metadata?.prompt ?? task.title),
    stopReason: task.status === 'running' ? 'running' : preview(task.metadata?.stopReason ?? task.status),
    pendingQuestion: preview(session?.pendingQuestion),
    output: preview(session?.result?.content ?? task.metadata?.output),
    summary: preview(session?.result?.summary ?? task.metadata?.summary),
    error: preview(session?.result?.error ?? task.errorPreview),
    tools: (session?.tools ?? []).map(t => ({ name: t.name, state: t.state, replay: t.replay,
      argsPreview: preview(t.args), resultPreview: preview(t.result?.content), isError: t.result?.isError ?? false })),
    executions: executions.map(e => ({ ...e, argsPreview: preview(e.argsPreview),
      resultPreview: preview(e.resultPreview), errorPreview: preview(e.errorPreview) })),
    approvals,
  };
}

export type TaskDetail = NonNullable<ReturnType<typeof getTaskDetail>>;
