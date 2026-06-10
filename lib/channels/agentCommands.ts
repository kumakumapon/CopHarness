/**
 * Channel-agnostic agent command parser and executor.
 *
 * Parses short text commands from LINE/Discord chat and executes them
 * against the task ledger and HIL approval store.
 */

import { queryTasks, getTask } from '../tasks/ledger';
import {
  listApprovalRequests,
  resolveApprovalRequest,
} from '../humanInLoop/store';
import { requestTaskCancellation } from '../tasks/cancellation';
import type { TaskRecord } from '../tasks/ledger';
import type { ApprovalRequest } from '../humanInLoop/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentCommand =
  | { kind: 'listTasks' }
  | { kind: 'taskDetail'; idPrefix: string }
  | { kind: 'stopTask'; idPrefix: string }
  | { kind: 'listApprovals' }
  | { kind: 'approve'; idPrefix: string }
  | { kind: 'reject'; idPrefix: string }
  | { kind: 'help' };

// ── Parser ────────────────────────────────────────────────────────────────────

const ID_RE = '[A-Za-z0-9_-]+';
const idCapture = `(${ID_RE})`;

// Compiled patterns: [regex, factory]
type CommandFactory = (m: RegExpMatchArray) => AgentCommand;
const COMMAND_PATTERNS: Array<[RegExp, CommandFactory]> = [
  // listTasks — exact keywords
  [/^(tasks|タスク|タスク一覧|進捗)$/i, () => ({ kind: 'listTasks' })],
  // taskDetail
  [new RegExp(`^(?:task|タスク)\\s+${idCapture}$`, 'i'), (m) => ({ kind: 'taskDetail', idPrefix: m[1] })],
  // stopTask
  [new RegExp(`^(?:stop|停止)\\s+${idCapture}$`, 'i'), (m) => ({ kind: 'stopTask', idPrefix: m[1] })],
  // listApprovals
  [/^(approvals|承認待ち|承認一覧)$/i, () => ({ kind: 'listApprovals' })],
  // approve
  [new RegExp(`^(?:approve|承認)\\s+${idCapture}$`, 'i'), (m) => ({ kind: 'approve', idPrefix: m[1] })],
  // reject
  [new RegExp(`^(?:reject|却下|拒否)\\s+${idCapture}$`, 'i'), (m) => ({ kind: 'reject', idPrefix: m[1] })],
  // help
  [/^(agent help|エージェントヘルプ)$/i, () => ({ kind: 'help' })],
];

/** Parse a chat message into an AgentCommand, or return null if unrecognized. */
export function parseAgentCommand(text: string): AgentCommand | null {
  const trimmed = text.trim();
  for (const [re, factory] of COMMAND_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return factory(m);
  }
  return null;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function statusEmoji(status: string): string {
  switch (status) {
    case 'running': return '🏃';
    case 'succeeded': return '✅';
    case 'failed': return '❌';
    case 'cancelled': return '🛑';
    default: return '❓';
  }
}

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 13)}…` : id;
}

function truncate(text: string | undefined, maxLen: number): string {
  if (!text) return '（タイトルなし）';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function relativeTime(isoStr: string | undefined): string {
  if (!isoStr) return '不明';
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 0) return '今';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}

function formatTaskLine(task: TaskRecord): string {
  const time = relativeTime(task.updatedAt);
  return `${statusEmoji(task.status)} ${shortId(task.id)} [${task.kind}] ${truncate(task.title, 30)} (${time})`;
}

function resolveTasksByPrefix(
  prefix: string,
  limit = 200,
  statusFilter?: string,
): TaskRecord[] {
  const { tasks } = queryTasks({ limit });
  // Support both raw id match and omitting the task_ prefix
  return tasks.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    return t.id.startsWith(prefix) || (prefix && t.id.startsWith(`task_${prefix}`));
  });
}

function resolveApprovalsByPrefix(prefix: string): ApprovalRequest[] {
  const pending = listApprovalRequests('pending');
  return pending.filter((r) => r.id.startsWith(prefix));
}

// ── Executor ──────────────────────────────────────────────────────────────────

export interface AgentCommandContext {
  personId?: string;
  channelKey?: string;
}

const HELP_TEXT = `\
エージェントコマンド一覧:
  tasks / タスク / タスク一覧 / 進捗   — タスク一覧
  task <id> / タスク <id>              — タスク詳細
  stop <id> / 停止 <id>               — タスク停止
  approvals / 承認待ち / 承認一覧       — 承認待ち一覧
  approve <id> / 承認 <id>            — 承認
  reject <id> / 却下 <id> / 拒否 <id> — 却下
  agent help / エージェントヘルプ       — このヘルプ`;

/**
 * Execute a parsed AgentCommand and return a mobile-friendly Japanese reply string.
 */
export async function executeAgentCommand(
  command: AgentCommand,
  ctx: AgentCommandContext,
): Promise<string> {
  switch (command.kind) {
    case 'listTasks': {
      const queryOpts: Parameters<typeof queryTasks>[0] = { limit: 10 };
      if (ctx.personId) queryOpts.personQuery = ctx.personId;
      else if (ctx.channelKey) queryOpts.channelQuery = ctx.channelKey;

      const { tasks } = queryTasks(queryOpts);
      if (tasks.length === 0) return 'タスクはまだありません。';

      const lines = tasks.map(formatTaskLine);
      lines.push('\ntask <id> で詳細');
      return lines.join('\n');
    }

    case 'taskDetail': {
      const matches = resolveTasksByPrefix(command.idPrefix);
      if (matches.length === 0) {
        return `タスクが見つかりません: ${command.idPrefix}`;
      }
      if (matches.length > 1) {
        const ids = matches.map((t) => t.id).join('\n');
        return `複数のタスクが見つかりました。IDを絞り込んでください:\n${ids}`;
      }
      const task = matches[0];
      const dag = task.metadata?.agentDag as Record<string, unknown> | undefined;
      let dagInfo = '';
      if (dag) {
        const nodes = dag.nodes as Array<{ status?: string }> | undefined;
        if (Array.isArray(nodes)) {
          const completed = nodes.filter((n) => n.status === 'succeeded').length;
          const failed = nodes.filter((n) => n.status === 'failed').length;
          dagInfo = `\nエージェントDAG: ${nodes.length}ノード（完了:${completed} 失敗:${failed}）`;
        }
      }
      const lines = [
        `ID: ${task.id}`,
        `状態: ${statusEmoji(task.status)} ${task.status}`,
        `種別: ${task.kind}`,
        `タイトル: ${task.title ?? '（なし）'}`,
        `ユーザー: ${task.personId ?? '不明'} / チャンネル: ${task.channelKey ?? '不明'}`,
        `開始: ${task.startedAt ? relativeTime(task.startedAt) : '不明'}`,
        `終了: ${task.finishedAt ? relativeTime(task.finishedAt) : '実行中'}`,
      ];
      if (task.errorPreview) lines.push(`エラー: ${task.errorPreview}`);
      if (dagInfo) lines.push(dagInfo);
      return lines.join('\n');
    }

    case 'stopTask': {
      const matches = resolveTasksByPrefix(command.idPrefix, 200, 'running');
      if (matches.length === 0) {
        // Check if it exists but not running
        const anyMatches = resolveTasksByPrefix(command.idPrefix);
        if (anyMatches.length > 0) {
          return `タスクは実行中ではありません: ${anyMatches[0].id}`;
        }
        return `実行中のタスクが見つかりません: ${command.idPrefix}`;
      }
      if (matches.length > 1) {
        const ids = matches.map((t) => t.id).join('\n');
        return `複数のタスクが見つかりました。IDを絞り込んでください:\n${ids}`;
      }
      const task = matches[0];
      const result = await requestTaskCancellation(task.id);
      switch (result) {
        case 'aborted':
          return `停止しました: ${task.id}`;
        case 'marked':
          return `停止を要求しました: ${task.id}`;
        case 'not_running':
          return `タスクは実行中ではありません: ${task.id}`;
        case 'not_found':
          return `タスクが見つかりません: ${task.id}`;
        default:
          return `不明なエラー: ${task.id}`;
      }
    }

    case 'listApprovals': {
      const pending = listApprovalRequests('pending');
      const top = pending.slice(0, 10);
      if (top.length === 0) return '承認待ちはありません。';

      const lines = top.map((r) => {
        const when = relativeTime(new Date(r.createdAt).toISOString());
        const by = r.requestedBy ? ` (by ${r.requestedBy})` : '';
        return `${r.id} — ${r.skillName}${by} (${when})`;
      });
      lines.push('\n承認 <id> / 却下 <id>');
      return lines.join('\n');
    }

    case 'approve':
    case 'reject': {
      const isApprove = command.kind === 'approve';
      const resolution = isApprove ? 'approved' : 'rejected';
      const verb = isApprove ? '承認' : '却下';
      const verbPast = isApprove ? '承認しました' : '却下しました';

      const matches = resolveApprovalsByPrefix(command.idPrefix);
      if (matches.length === 0) {
        return `承認待ちリクエストが見つかりません: ${command.idPrefix}`;
      }
      if (matches.length > 1) {
        const ids = matches.map((r) => r.id).join('\n');
        return `複数の${verb}リクエストが見つかりました。IDを絞り込んでください:\n${ids}`;
      }
      const req = matches[0];
      const ok = resolveApprovalRequest(req.id, resolution);
      if (!ok) {
        return `${verb}に失敗しました（すでに処理済みかもしれません）: ${req.id}`;
      }
      return `${verbPast}: ${req.skillName} (${req.id})`;
    }

    case 'help':
      return HELP_TEXT;

    default:
      return 'コマンドを認識できませんでした。「agent help」でヘルプを表示します。';
  }
}
