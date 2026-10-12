'use client';

import { useState, Fragment } from 'react';
import useSWR from 'swr';
import type { TaskDetail } from '../../../lib/dashboard/taskDetail';
import {
  RefreshCw,
  Clock,
} from 'lucide-react';
import type { DashboardAgentDag, DashboardAgentDagPlan, DashboardTask, SkillExecutionFilters, TaskFilters, TasksData } from './types';
import { dashboardFetch, fetcher } from './api';
import { fmtDate } from './shared';


// ---------------------------------------------------------------------------
// Section: Identities Panel
// ---------------------------------------------------------------------------

export const TASK_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '実行中' },
  succeeded: { bg: 'bg-green-100', text: 'text-green-700', label: '成功' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '失敗' },
  iteration_limit: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '反復上限' },
  stalled: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '応答停止' },
  waiting_input: { bg: 'bg-blue-100', text: 'text-blue-700', label: '回答待ち' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-600', label: '取消' },
};



function taskMetadataPreview(metadata?: Record<string, unknown>): string {
  if (!metadata) return '—';
  const text = JSON.stringify(metadata);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}


const DAG_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', label: '待機' },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '実行中' },
  succeeded: { bg: 'bg-green-100', text: 'text-green-700', label: '成功' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '失敗' },
  skipped: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'スキップ' },
};


function isAgentDag(value: unknown): value is DashboardAgentDag {
  if (!value || typeof value !== 'object') return false;
  const dag = value as Partial<DashboardAgentDag>;
  return typeof dag.runId === 'string' && Array.isArray(dag.plans) && Array.isArray(dag.progress);
}


function agentDagFromTask(task: DashboardTask): DashboardAgentDag | undefined {
  const value = task.metadata?.agentDag;
  return isAgentDag(value) ? value : undefined;
}


function computeLayers(plans: DashboardAgentDagPlan[]): DashboardAgentDagPlan[][] {
  const layers: DashboardAgentDagPlan[][] = [];
  const placed = new Set<string>();
  let remaining = [...plans];
  while (remaining.length > 0) {
    const layer = remaining.filter(p =>
      !p.dependsOn?.length || p.dependsOn.every(d => placed.has(d))
    );
    if (layer.length === 0) { layers.push(remaining); break; } // cycle fallback
    layers.push(layer);
    layer.forEach(p => placed.add(p.id));
    remaining = remaining.filter(p => !placed.has(p.id));
  }
  return layers;
}


function AgentDagMiniGraph({
  dag,
  taskId,
  retryingPlanId,
  onRetry,
  expanded,
}: {
  dag: DashboardAgentDag;
  taskId: string;
  retryingPlanId?: string;
  onRetry: (taskId: string, planId: string) => void;
  expanded?: boolean;
}) {
  const progressById = new Map(dag.progress.map((entry) => [entry.planId, entry]));
  const completed = dag.progress.filter((entry) => entry.status === 'succeeded').length;
  const failed = dag.progress.filter((entry) => entry.status === 'failed').length;
  const skipped = dag.progress.filter((entry) => entry.status === 'skipped').length;
  const total = dag.plans.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const layers = computeLayers(dag.plans);

  return (
    <div className="mt-2 rounded-lg p-2 space-y-2" style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{dag.runId}</span>
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {completed}/{total} 完了
          {failed > 0 ? ` / 失敗 ${failed}` : ''}
          {skipped > 0 ? ` / skip ${skipped}` : ''}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${progressPct}%`, background: failed > 0 ? '#ef4444' : 'var(--accent-warm)' }}
        />
      </div>
      {/* Layered DAG nodes */}
      <div className="space-y-1">
        {layers.map((layer, layerIdx) => (
          <div key={layerIdx}>
            <div className={`flex flex-wrap gap-2 ${expanded ? '' : 'flex-nowrap overflow-x-auto'}`}>
              {layer.map((plan) => {
                const progress = progressById.get(plan.id);
                const st = DAG_STATUS_STYLES[progress?.status ?? 'pending'] ?? DAG_STATUS_STYLES.pending;
                const deps = plan.dependsOn?.length ? plan.dependsOn.join(', ') : null;
                const canRetry = progress?.status === 'failed' || progress?.status === 'skipped';
                const isRetrying = retryingPlanId === plan.id;
                return (
                  <div
                    key={plan.id}
                    className={`rounded-md p-2 ${expanded ? 'min-w-[180px] max-w-[260px]' : 'min-w-[160px] max-w-[220px]'}`}
                    style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)', flexShrink: 0 }}
                    title={progress?.error || plan.workspace || plan.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }}>{plan.id}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>{st.label}</span>
                    </div>
                    <div className="truncate mt-1" style={{ color: 'var(--text-secondary)' }}>{plan.role}</div>
                    {deps ? (
                      <div className="truncate font-mono mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        ← 依存: {deps}
                      </div>
                    ) : (
                      <div className="font-mono mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>root</div>
                    )}
                    {progress?.error ? <div className="truncate mt-1 text-red-600 text-[10px]">error: {progress.error}</div> : null}
                    {canRetry ? (
                      <button
                        type="button"
                        disabled={isRetrying || dag.status === 'running'}
                        onClick={() => onRetry(taskId, plan.id)}
                        className="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                        style={{ background: 'var(--accent-warm)', color: 'var(--text-primary)' }}
                      >
                        <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                        再実行
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {layerIdx < layers.length - 1 && (
              <div className="flex justify-center py-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>↓</div>
            )}
          </div>
        ))}
      </div>
      <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
        updated: {fmtDate(dag.updatedAt)}
      </div>
    </div>
  );
}


export function TasksPanel({
  data,
  filters,
  onFiltersChange,
  onSkillExecutionFiltersChange,
  onTasksMutate,
}: {
  data: TasksData | undefined;
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  onSkillExecutionFiltersChange: (filters: SkillExecutionFilters) => void;
  onTasksMutate: () => void;
}) {
  const [retrying, setRetrying] = useState<Record<string, string>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const toggleExpanded = (taskId: string) => setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  const updateFilter = (key: keyof TaskFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };
  const clearFilters = () => onFiltersChange({ status: '', kindQuery: '', personQuery: '', channelQuery: '', from: '', to: '' });
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const showSkillExecutionsForTask = (task: DashboardTask) => {
    onSkillExecutionFiltersChange({
      status: '',
      riskLevel: '',
      personQuery: '',
      channelQuery: '',
      taskQuery: task.id,
      from: '',
      to: '',
    });
  };

  const retryAgentDagPlan = async (taskId: string, planId: string) => {
    setRetrying((current) => ({ ...current, [taskId]: planId }));
    try {
      const res = await dashboardFetch(`/api/dashboard/tasks/${taskId}/agent-dag/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        window.alert(data.error ?? 'Retry failed');
      }
      onTasksMutate();
    } finally {
      setRetrying((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  };

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Clock className="w-4 h-4" /> TaskLedger
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {hasActiveFilters ? '絞り込み結果' : '最新'} {data.total} 件
          </span>
        )}
      </h2>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
        <div className="px-4 py-3 flex flex-col gap-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              状態
              <select
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={filters.status}
                onChange={(e) => updateFilter('status', e.target.value)}
              >
                <option value="">すべて</option>
                <option value="running">実行中</option>
                <option value="succeeded">成功</option>
                <option value="failed">失敗</option>
                <option value="cancelled">取消</option>
                <option value="iteration_limit">反復上限</option>
                <option value="stalled">応答停止</option>
                <option value="waiting_input">回答待ち</option>
              </select>
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              種別
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="conversation / schedule"
                value={filters.kindQuery}
                onChange={(e) => updateFilter('kindQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              人物
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="personId"
                value={filters.personQuery}
                onChange={(e) => updateFilter('personQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              チャネル
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="channelKey"
                value={filters.channelQuery}
                onChange={(e) => updateFilter('channelQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              更新日 From
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={filters.from}
                onChange={(e) => updateFilter('from', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              更新日 To
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={filters.to}
                onChange={(e) => updateFilter('to', e.target.value)}
              />
            </label>
          </div>
          {hasActiveFilters && (
            <button type="button" className="self-start text-xs underline" style={{ color: 'var(--text-secondary)' }} onClick={clearFilters}>
              絞り込みをクリア
            </button>
          )}
        </div>

        {!data ? (
          <div className="h-28 animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
        ) : data.tasks.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: 'var(--text-secondary)' }}>TaskLedger に一致するタスクはありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                <tr>
                  {['更新', '状態', '種別', 'タイトル / ID', '人物 / チャネル', '期間', 'メタデータ / エラー', '関連'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((task) => {
                  const st = TASK_STATUS_STYLES[task.status] ?? TASK_STATUS_STYLES.running;
                  const agentDag = agentDagFromTask(task);
                  const isExpanded = expandedTaskId === task.id;
                  const colCount = 8;
                  return (
                    <Fragment key={task.id}>
                      <tr
                        style={{ borderTop: '1px solid var(--border-color)', cursor: 'pointer' }}
                        onClick={() => toggleExpanded(task.id)}
                      >
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          <span className="mr-1" style={{ color: 'var(--text-secondary)' }}>{isExpanded ? '▾' : '▸'}</span>
                          {fmtDate(task.updatedAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className={`inline-block px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>{st.label}</span></td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{task.kind}</td>
                        <td className="px-3 py-2 max-w-[260px]">
                          <button type="button" className="block max-w-full truncate text-left underline" style={{ color: 'var(--text-primary)' }} title={task.title || task.id}
                            aria-expanded={isExpanded} onClick={(e) => { e.stopPropagation(); toggleExpanded(task.id); }}>{task.title || task.id}</button>
                          <div className="font-mono truncate" style={{ color: 'var(--text-secondary)' }} title={task.id}>{task.id}</div>
                        </td>
                        <td className="px-3 py-2 font-mono max-w-[220px]" style={{ color: 'var(--text-secondary)' }}>
                          <div className="truncate">{task.personId || '—'}</div>
                          <div className="truncate">{task.channelKey || '—'}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          <div>開始: {fmtDate(task.startedAt)}</div>
                          <div>終了: {task.finishedAt ? fmtDate(task.finishedAt) : '—'}</div>
                        </td>
                        <td className="px-3 py-2 max-w-[300px]" style={{ color: 'var(--text-secondary)' }}>
                          {task.errorPreview ? <div className="truncate text-red-600">error: {task.errorPreview}</div> : null}
                          {agentDag ? (
                            <AgentDagMiniGraph
                              dag={agentDag}
                              taskId={task.id}
                              retryingPlanId={retrying[task.id]}
                              onRetry={retryAgentDagPlan}
                            />
                          ) : (
                            <div className="font-mono truncate" title={taskMetadataPreview(task.metadata)}>{taskMetadataPreview(task.metadata)}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="text-xs underline" style={{ color: 'var(--text-primary)' }} onClick={() => showSkillExecutionsForTask(task)}>
                            スキル履歴へ
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td colSpan={colCount} className="px-4 py-4" style={{ background: 'var(--primary-bg)' }}>
                            <div className="space-y-3 text-xs">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>タスク ID</div>
                                  <div className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>{task.id}</div>
                                </div>
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>タイトル</div>
                                  <div className="break-words" style={{ color: 'var(--text-primary)' }}>{task.title || '—'}</div>
                                </div>
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>会話キー</div>
                                  <div className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>{task.conversationKey || '—'}</div>
                                </div>
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>タイムスタンプ</div>
                                  <div className="space-y-0.5 font-mono" style={{ color: 'var(--text-primary)' }}>
                                    <div>作成: {fmtDate(task.createdAt)}</div>
                                    <div>開始: {fmtDate(task.startedAt)}</div>
                                    <div>更新: {fmtDate(task.updatedAt)}</div>
                                    <div>終了: {task.finishedAt ? fmtDate(task.finishedAt) : '—'}</div>
                                  </div>
                                </div>
                              </div>
                              <TaskRunDetail taskId={task.id} />
                              {task.errorPreview && (
                                <div>
                                  <div className="font-semibold mb-1 text-red-600">エラー</div>
                                  <pre className="whitespace-pre-wrap break-all rounded p-2 text-[11px] text-red-600" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>{task.errorPreview}</pre>
                                </div>
                              )}
                              {task.metadata && (
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>メタデータ (JSON)</div>
                                  <pre className="whitespace-pre-wrap break-all rounded p-2 text-[11px]" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>{JSON.stringify(task.metadata, null, 2)}</pre>
                                </div>
                              )}
                              {agentDag && (
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Agent DAG</div>
                                  <AgentDagMiniGraph
                                    dag={agentDag}
                                    taskId={task.id}
                                    retryingPlanId={retrying[task.id]}
                                    onRetry={retryAgentDagPlan}
                                    expanded={true}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}


function TaskRunDetail({ taskId }: { taskId: string }) {
  const { data, error, mutate: reload } = useSWR<TaskDetail>(`/api/dashboard/tasks/${encodeURIComponent(taskId)}`, fetcher, { refreshInterval: 5000 });
  if (error) return <div role="alert">タスク詳細を取得できません。<button type="button" className="underline ml-2" onClick={() => void reload()}>再読込</button></div>;
  if (!data) return <p role="status">実行記録を読み込み中…</p>;
  const block = (label: string, text: string) => <div><h3 className="font-semibold mb-1">{label}</h3><pre className="whitespace-pre-wrap break-all max-h-64 overflow-auto rounded p-2" style={{ background: 'var(--secondary-bg)' }}>{text || '記録なし'}</pre></div>;
  return <section aria-label="タスク実行詳細" className="space-y-3 max-w-[calc(100vw-5rem)] md:max-w-none" style={{ color: 'var(--text-primary)' }}>
    {block('入力・目標', data.input)}
    <h3 className="font-semibold">ツール・成果物の記録</h3>
    <p>結果内の保存先や通知先を確認できます。表示は機密値を伏せたプレビューです。</p>
    {data.tools.length === 0 && data.executions.length === 0 && <p>ツール記録なし</p>}
    {data.tools.map((tool, i) => <details key={i} className="rounded border p-2">
      <summary>{tool.name} — {tool.state}{tool.isError ? ' / error' : ''} / {tool.replay === 'reuse' ? '保存結果を再利用' : '再実行可能'}</summary>
      {block('引数', tool.argsPreview)}{block('結果・保存先', tool.resultPreview)}
    </details>)}
    {data.executions.map(e => <details key={e.id} className="rounded border p-2">
      <summary>{e.skillName} — {e.status} / {e.finishedAt}</summary>
      {block('引数', e.argsPreview)}{block('結果', e.errorPreview || e.resultPreview)}
      {e.approvalId && <p>承認 ID: {e.approvalId}</p>}
    </details>)}
    <h3 className="font-semibold">承認</h3>
    {data.approvals.length === 0 ? <p>関連する承認記録なし</p> : data.approvals.map(a => <details key={a.id} className="rounded border p-2">
      <summary>{a.skillName} — {a.status} / {a.id}</summary>
      {block('承認対象', a.argsPreview)}{a.preview && block('変更プレビュー', a.preview)}
      {a.status === 'pending' && <p>承認パネルでこの ID の内容を確認して承認または拒否してください。</p>}
    </details>)}
    {block('最終出力', data.output)}
    {block('終了理由', [data.stopReason, data.summary, data.error].filter(Boolean).join('\n'))}
    {data.pendingQuestion && block('回答待ち', data.pendingQuestion)}
    {data.checkpointWarning && <p role="alert">{data.checkpointWarning}</p>}
    {data.checkpointStatus && data.checkpointStatus !== data.status && <p role="alert">台帳と保存セッションの状態が異なります（保存: {data.checkpointStatus}）。再開前に実行記録を確認してください。</p>}
    <p>履歴は保持期間内の記録です。旧記録や別プロセスの承認待ちは表示できない場合があります。</p>
  </section>;
}
