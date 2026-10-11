'use client';

import {
  Wrench,
} from 'lucide-react';
import type { SkillExecutionFilters, SkillExecutionsData, SkillsData } from './types';
import { fmtDate } from './shared';


// ---------------------------------------------------------------------------
// Section: Skills Panel
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  utility: 'ユーティリティ',
  file: 'ファイル',
  web: 'Web',
  system: 'システム',
  memory: 'メモリ',
  external: '外部API',
};


export const RISK_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low:    { bg: 'bg-green-100', text: 'text-green-700', label: '低' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '中' },
  high:   { bg: 'bg-red-100',   text: 'text-red-700',   label: '高' },
};


const APPROVAL_POLICY_LABELS: Record<string, string> = {
  alwaysAllow: '常に許可',
  allowForSession: 'セッション許可',
  allowWithDryRun: 'Dry-run許可',
  requireApproval: '承認必須',
  deny: '拒否',
};


export function SkillsPanel({
  data,
  executionsData,
  executionFilters,
  onExecutionFiltersChange,
}: {
  data: SkillsData | undefined;
  executionsData: SkillExecutionsData | undefined;
  executionFilters: SkillExecutionFilters;
  onExecutionFiltersChange: (filters: SkillExecutionFilters) => void;
}) {
  const updateFilter = (key: keyof SkillExecutionFilters, value: string) => {
    onExecutionFiltersChange({ ...executionFilters, [key]: value });
  };

  const clearFilters = () => {
    onExecutionFiltersChange({ status: '', riskLevel: '', personQuery: '', channelQuery: '', taskQuery: '', from: '', to: '' });
  };

  const hasActiveFilters = Object.values(executionFilters).some(Boolean);
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Wrench className="w-4 h-4" /> スキル一覧
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.skills.filter((s) => s.enabled).length} / {data.skills.length} 件有効
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.skills.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          登録済みスキルがありません。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.skills.map((skill) => {
            const risk = RISK_STYLES[skill.riskLevel] ?? RISK_STYLES.low;
            const categoryLabel = CATEGORY_LABELS[skill.category] ?? skill.category;
            return (
              <div key={skill.name} className="rounded-xl p-4 flex flex-col gap-2"
                style={{
                  background: 'var(--secondary-bg)',
                  border: `1px solid ${skill.enabled ? '#bbf7d0' : 'var(--border-color)'}`,
                  opacity: skill.enabled ? 1 : 0.6,
                }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{skill.name}</div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${skill.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {skill.enabled ? '有効' : '無効'}
                    </span>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${risk.bg} ${risk.text}`}>
                      リスク: {risk.label}
                    </span>
                  </div>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{skill.description}</div>
                {skill.approvalPolicy && (
                  <div className="text-[11px] rounded px-2 py-1" style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                    承認ポリシー: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{APPROVAL_POLICY_LABELS[skill.approvalPolicy.mode] ?? skill.approvalPolicy.mode}</span>
                    {skill.approvalPolicy.ruleId ? <span className="ml-1 font-mono">({skill.approvalPolicy.ruleId})</span> : null}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 rounded-lg p-2 text-xs" style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)' }}>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{skill.metrics.totalRuns}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>実行</div>
                  </div>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {skill.metrics.successRate == null ? '—' : `${Math.round(skill.metrics.successRate * 100)}%`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>成功率</div>
                  </div>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {skill.metrics.averageDurationMs == null ? '—' : `${skill.metrics.averageDurationMs}ms`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>平均</div>
                  </div>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  最終実行: {skill.metrics.lastRunAt ? fmtDate(skill.metrics.lastRunAt) : '—'}
                  {skill.metrics.lastStatus && (
                    <span className="ml-2">
                      ({skill.metrics.lastStatus === 'success' ? '成功' : skill.metrics.lastStatus === 'error' ? 'エラー結果' : '例外'})
                    </span>
                  )}
                </div>
                {skill.metrics.lastErrorPreview && (
                  <div className="text-[11px] rounded px-2 py-1 bg-red-50 text-red-700 border border-red-100">
                    直近エラー: {skill.metrics.lastErrorPreview}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                    style={{ background: 'var(--accent-warm)', color: 'var(--text-secondary)' }}>
                    {categoryLabel}
                  </span>
                  {skill.requiresEnv.map((env) => (
                    <span key={env} className="inline-block px-1.5 py-0.5 rounded text-xs font-mono"
                      style={{ background: 'var(--accent-peachy)', color: 'var(--text-secondary)' }}>
                      {env}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 rounded-xl overflow-hidden" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
        <div className="px-4 py-3 flex flex-col gap-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>スキル実行履歴</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {hasActiveFilters ? '絞り込み結果' : '最新'} {executionsData?.total ?? 0} 件
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              状態
              <select
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.status}
                onChange={(e) => updateFilter('status', e.target.value)}
              >
                <option value="">すべて</option>
                <option value="success">成功</option>
                <option value="error">エラー結果</option>
                <option value="exception">例外</option>
              </select>
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              リスク
              <select
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.riskLevel}
                onChange={(e) => updateFilter('riskLevel', e.target.value)}
              >
                <option value="">すべて</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              人物
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="personId"
                value={executionFilters.personQuery}
                onChange={(e) => updateFilter('personQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              チャネル
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="channelKey"
                value={executionFilters.channelQuery}
                onChange={(e) => updateFilter('channelQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              タスク
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="taskId"
                value={executionFilters.taskQuery}
                onChange={(e) => updateFilter('taskQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              開始日
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.from}
                onChange={(e) => updateFilter('from', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              終了日
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.to}
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
        {!executionsData ? (
          <div className="h-20 animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
        ) : executionsData.executions.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: 'var(--text-secondary)' }}>実行履歴はまだありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                <tr>
                  {['時刻', 'スキル', '状態', 'リスク', '所要時間', '人物 / チャネル / タスク', '承認', '引数 / 結果'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {executionsData.executions.map((execution) => (
                  <tr key={execution.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(execution.finishedAt)}</td>
                    <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }}>{execution.skillName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.5 rounded ${execution.status === 'success' ? 'bg-green-100 text-green-700' : execution.status === 'error' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                        {execution.status === 'success' ? '成功' : execution.status === 'error' ? 'エラー結果' : '例外'}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {execution.riskLevel ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded ${RISK_STYLES[execution.riskLevel]?.bg ?? RISK_STYLES.low.bg} ${RISK_STYLES[execution.riskLevel]?.text ?? RISK_STYLES.low.text}`}>
                          {RISK_STYLES[execution.riskLevel]?.label ?? execution.riskLevel}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{execution.durationMs}ms</td>
                    <td className="px-3 py-2 font-mono max-w-[220px] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {[execution.personId, execution.channelKey, execution.taskId].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono max-w-[120px] truncate" style={{ color: 'var(--text-secondary)' }}>{execution.approvalId ?? '—'}</td>
                    <td className="px-3 py-2 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                      <div className="truncate">args: {execution.argsPreview || '—'}</div>
                      {(execution.resultPreview || execution.errorPreview) && (
                        <div className="truncate">{execution.errorPreview ? `error: ${execution.errorPreview}` : `result: ${execution.resultPreview}`}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
