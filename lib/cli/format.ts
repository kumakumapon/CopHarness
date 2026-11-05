/** Terminal formatting helpers for the CLI. */
import type { TodoItem, TurnStopReason, Usage } from '../types';
import { totalTokens } from '../usage';

const enabled = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (enabled() ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  dim: wrap('2'),
  bold: wrap('1'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

export function oneLine(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function formatToolCall(name: string, summary: string, agent?: string): string {
  const prefix = agent ? `${c.gray(`  ↳ [${agent}]`)} ` : '';
  return `${prefix}${c.cyan('⏺')} ${c.bold(name)} ${c.gray(oneLine(summary, 120))}`;
}

export function formatToolResult(content: string, isError: boolean, durationMs: number, agent?: string): string {
  const indent = agent ? '      ' : '  ';
  const lines = content.split('\n').filter(l => l.trim());
  const preview = isError ? oneLine(content, 160) : lines.length > 1 ? `${oneLine(lines[0], 100)} ${c.gray(`(+${lines.length - 1} 行)`)}` : oneLine(content, 140);
  const time = durationMs >= 1000 ? c.gray(` ${(durationMs / 1000).toFixed(1)}s`) : '';
  return `${indent}${c.gray('⎿')} ${isError ? c.red(preview || 'エラー') : c.gray(preview || '完了')}${time}`;
}

export function formatTodos(todos: TodoItem[]): string {
  const mark = { pending: '☐', in_progress: c.yellow('◐'), completed: c.green('☑') } as const;
  return todos.map(t => `  ${mark[t.status]} ${t.status === 'completed' ? c.gray(t.content) : t.content}`).join('\n');
}

export function formatUsage(usage: Usage, costUsd?: number): string {
  const cost = costUsd !== undefined ? ` · $${costUsd.toFixed(costUsd < 0.01 ? 4 : 3)}` : '';
  return `${totalTokens(usage).toLocaleString()} tokens${cost}`;
}

export const STOP_LABELS: Record<TurnStopReason, string> = {
  end_turn: '完了',
  max_turns: '1ターンの上限回数に達しました',
  max_tokens: '出力トークンの上限に達しました',
  refusal: 'モデルが応答を拒否しました',
  cancelled: '中断しました',
  budget: '日次上限に達しました',
  blocked: 'フックにより拒否されました',
  error: 'エラーで終了しました',
};
