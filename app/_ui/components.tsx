'use client';

import { useState } from 'react';
import { AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Hash, Loader2, MessageSquare, Plus, ShieldAlert, Terminal, Trash2, X } from 'lucide-react';
import type { PermissionDecision, TodoItem } from '../../lib/types';
import { Markdown } from './Markdown';
import { relativeTime } from './client';
import type { Item } from './timeline';

export interface SessionSummary {
  id: string;
  title: string;
  owner: string;
  channel?: string;
  updatedAt: string;
  running: boolean;
}

const STOP_LABELS: Record<string, string> = {
  end_turn: '完了',
  max_turns: '上限回数に達しました（続けるにはメッセージを送信）',
  max_tokens: '出力上限に達しました',
  refusal: 'モデルが応答を拒否しました',
  cancelled: '中断しました',
  budget: '日次上限に達しました',
  blocked: 'フックにより拒否されました',
  error: 'エラーで終了しました',
};

function ownerBadge(owner: string, channel?: string) {
  const source = channel ?? owner.split(/[:-]/)[0];
  const label: Record<string, string> = { web: 'Web', local: 'CLI', api: 'API', discord: 'Discord', line: 'LINE', slack: 'Slack', schedule: '定期' };
  return label[source] ?? source;
}

export function Sidebar(props: {
  sessions: SessionSummary[];
  currentId?: string;
  waiting: Set<string>;
  onSelect(id: string): void;
  onNew(): void;
  onDelete(id: string): void;
}) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 px-4 py-3">
        <Bot className="h-5 w-5 text-orange-500" />
        <span className="font-semibold">CopHarness</span>
      </div>
      <div className="px-3 pb-2">
        <button onClick={props.onNew} className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700">
          <Plus className="h-4 w-4" /> 新しい会話
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {props.sessions.length === 0 && <p className="px-3 py-6 text-center text-xs text-zinc-500">まだ会話はありません</p>}
        {props.sessions.map(s => (
          <div key={s.id} className={`group mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${s.id === props.currentId ? 'bg-zinc-200 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'}`} onClick={() => props.onSelect(s.id)}>
            {s.running ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-orange-500" /> : <MessageSquare className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
            <div className="min-w-0 flex-1">
              <div className="truncate">{s.title}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span>{ownerBadge(s.owner, s.channel)}</span>·<span>{relativeTime(s.updatedAt)}</span>
                {props.waiting.has(s.id) && <span className="rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">承認待ち</span>}
              </div>
            </div>
            <button aria-label="削除" className="hidden rounded p-1 text-zinc-400 hover:bg-zinc-300 hover:text-zinc-700 group-hover:block dark:hover:bg-zinc-700" onClick={e => { e.stopPropagation(); props.onDelete(s.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function ToolRow({ item }: { item: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const running = item.result === undefined;
  return (
    <div className={`my-1 ${item.agent ? 'ml-6' : ''}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800">
        {running ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" /> : item.isError ? <X className="h-3.5 w-3.5 shrink-0 text-red-500" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        {item.agent && <span className="shrink-0 rounded bg-violet-100 px-1 text-[11px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{item.agent}</span>}
        <span className="shrink-0 font-medium">{item.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-500">{item.summary}</span>
        {item.durationMs !== undefined && item.durationMs >= 1000 && <span className="text-[11px] text-zinc-400">{(item.durationMs / 1000).toFixed(1)}s</span>}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
      </button>
      {open && (
        <div className="mx-2 mb-2 space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-900">
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap font-mono text-zinc-600 dark:text-zinc-400">{JSON.stringify(item.input, null, 2)}</pre>
          {item.result !== undefined && <pre className={`max-h-80 overflow-auto whitespace-pre-wrap font-mono ${item.isError ? 'text-red-600 dark:text-red-400' : ''}`}>{item.result}</pre>}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ item, onDecide }: { item: Extract<Item, { kind: 'approval' }>; onDecide(id: string, d: PermissionDecision): void }) {
  const { request, decision, by } = item;
  const label = decision === 'deny' ? (by === 'timeout' ? '期限切れで拒否されました' : by === 'cancelled' ? '中断されました' : '拒否しました') : decision ? '許可しました' : undefined;
  return (
    <div className="my-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/40">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4" /> {request.tool} の実行に承認が必要です
      </div>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white/70 p-2 font-mono text-[12px] dark:bg-black/30">{request.summary}</pre>
      <div className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-300/70">{request.reason}</div>
      {label ? (
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{label}</div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => onDecide(request.id, 'allow')} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">許可</button>
          <button onClick={() => onDecide(request.id, 'allow_always')} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700">この会話では常に許可</button>
          <button onClick={() => onDecide(request.id, 'deny')} className="rounded-lg px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-950">拒否</button>
        </div>
      )}
    </div>
  );
}

export function Timeline({ items, onDecide }: { items: Item[]; onDecide(id: string, d: PermissionDecision): void }) {
  return (
    <div className="space-y-1">
      {items.map(item => {
        switch (item.kind) {
          case 'user':
            return (
              <div key={item.key} className="flex justify-end py-2">
                <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2 dark:bg-zinc-800">
                  {item.images.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {item.images.map((img, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="添付画像" className="h-24 rounded-md object-cover" />
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{item.text}</div>
                </div>
              </div>
            );
          case 'assistant':
            return (
              <div key={item.key} className="py-1">
                {item.reasoning && (
                  <details className="mb-1 text-[13px] text-zinc-500">
                    <summary className="cursor-pointer select-none">思考過程</summary>
                    <div className="mt-1 whitespace-pre-wrap border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">{item.reasoning}</div>
                  </details>
                )}
                {item.text && <Markdown text={item.text} />}
                {item.streaming && !item.text && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
              </div>
            );
          case 'tool':
            return <ToolRow key={item.key} item={item} />;
          case 'approval':
            return <ApprovalCard key={item.key} item={item} onDecide={onDecide} />;
          case 'summary':
            return (
              <details key={item.key} className="my-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-[13px] text-zinc-500 dark:border-zinc-700">
                <summary className="cursor-pointer select-none">以前の会話は要約されています</summary>
                <div className="mt-2 whitespace-pre-wrap">{item.text}</div>
              </details>
            );
          case 'notice':
            return (
              <div key={item.key} className={`my-1 flex items-start gap-2 text-[13px] ${item.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500'}`}>
                {item.tone === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>{item.text}</span>
              </div>
            );
          case 'end':
            return (
              <div key={item.key} className={`pb-3 pt-1 text-[11px] ${item.stopReason === 'end_turn' ? 'text-zinc-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {STOP_LABELS[item.stopReason] ?? item.stopReason} · {item.tokens.toLocaleString()} tokens{item.costUsd !== undefined ? ` · $${item.costUsd.toFixed(4)}` : ''}
              </div>
            );
        }
      })}
    </div>
  );
}

export function Todos({ todos }: { todos: TodoItem[] }) {
  if (!todos.length || todos.every(t => t.status === 'completed')) return null;
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1 text-[11px] font-medium text-zinc-500">作業リスト {todos.filter(t => t.status === 'completed').length}/{todos.length}</div>
      {todos.map((t, i) => (
        <div key={i} className={`flex items-center gap-2 ${t.status === 'completed' ? 'text-zinc-400 line-through' : ''}`}>
          {t.status === 'completed' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : t.status === 'in_progress' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" /> : <span className="inline-block h-3.5 w-3.5 rounded-full border border-zinc-300 dark:border-zinc-600" />}
          {t.content}
        </div>
      ))}
    </div>
  );
}

export const SUGGESTIONS = [
  { title: 'ワークスペースを調べる', prompt: 'ワークスペースにどんなファイルがあるか調べて、概要を教えて' },
  { title: 'Web ページを要約', prompt: '次のページを読んで3行で要約して: https://' },
  { title: '計画してから作業', prompt: '簡単な TODO アプリの設計を考えて、workspace/todo-design.md に書いて' },
  { title: '覚えてもらう', prompt: '覚えておいて: 返答は簡潔に、結論から書いてほしい' },
];

export function Empty({ onPick }: { onPick(prompt: string): void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-[12vh] text-center">
      <Terminal className="mb-3 h-8 w-8 text-orange-500" />
      <h1 className="text-2xl font-semibold">何をしましょうか？</h1>
      <p className="mt-2 text-sm text-zinc-500">ファイル操作・コマンド実行・Web 取得などのツールを使って作業します。<br />変更を伴う操作は実行前に確認します。</p>
      <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map(s => (
          <button key={s.title} onClick={() => onPick(s.prompt)} className="rounded-xl border border-zinc-200 p-3 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <div className="font-medium">{s.title}</div>
            <div className="mt-0.5 truncate text-xs text-zinc-500">{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
