'use client';

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Play,
  Zap,
} from 'lucide-react';
import type { SkillProposalStatusFilter, SkillProposalsData } from './types';
import { dashboardFetch } from './api';
import { fmtDate } from './shared';
import { RISK_STYLES } from './SkillsPanel';


// ---------------------------------------------------------------------------
// Section: Skill Proposals Panel
// ---------------------------------------------------------------------------

const PROPOSAL_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:              { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Draft' },
  testing:            { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Testing' },
  tests_failed:       { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Tests Failed' },
  awaiting_approval:  { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Awaiting Approval' },
  approved:           { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Approved' },
  rejected:           { bg: 'bg-red-100',    text: 'text-red-600',    label: 'Rejected' },
  registered:         { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Registered' },
};


const MAX_PROBLEM_LENGTH = 120;


export function SkillProposalsPanel({
  data,
  statusFilter,
  onStatusFilterChange,
  onMutate,
}: {
  data: SkillProposalsData | undefined;
  statusFilter: SkillProposalStatusFilter;
  onStatusFilterChange: (s: SkillProposalStatusFilter) => void;
  onMutate: () => void;
}) {
  const [loading, setLoading] = useState<Record<string, string>>({});

  async function proposalAction(id: string, action: 'test' | 'approve' | 'reject') {
    setLoading((l) => ({ ...l, [id]: action }));
    await dashboardFetch(`/api/dashboard/skill-proposals/${id}/${action}`, { method: 'POST' });
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[id]; return n; });
  }

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Zap className="w-4 h-4" /> Skill Proposals
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.total} 件
          </span>
        )}
      </h2>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <label className="flex flex-col gap-1 text-xs w-48" style={{ color: 'var(--text-secondary)' }}>
            ステータスで絞り込み
            <select
              className="rounded px-2 py-1"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value as SkillProposalStatusFilter)}
            >
              <option value="">すべて</option>
              <option value="draft">Draft</option>
              <option value="testing">Testing</option>
              <option value="tests_failed">Tests Failed</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="registered">Registered</option>
            </select>
          </label>
        </div>

        {!data ? (
          <div className="h-24 animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
        ) : data.proposals.length === 0 ? (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            スキルプロポーザルはありません。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                <tr>
                  {['名前', 'ステータス', 'リスク', '課題 (抜粋)', 'テスト結果', '作成日時', '更新日時', '操作'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.proposals.map((p) => {
                  const st = PROPOSAL_STATUS_STYLES[p.status] ?? PROPOSAL_STATUS_STYLES.draft;
                  const risk = RISK_STYLES[p.riskLevel] ?? RISK_STYLES.low;
                  const passCount = p.testResults?.filter((r) => r.passed).length ?? 0;
                  const totalTests = p.testResults?.length ?? 0;
                  const problemText =
                    p.problem.length > MAX_PROBLEM_LENGTH
                      ? `${p.problem.slice(0, MAX_PROBLEM_LENGTH)}…`
                      : p.problem;
                  const isLoading = !!loading[p.id];
                  return (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {p.name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded ${risk.bg} ${risk.text}`}>
                          {risk.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[300px]" style={{ color: 'var(--text-secondary)' }}>
                        {problemText}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {p.testResults
                          ? (
                            <span className={passCount === totalTests && totalTests > 0 ? 'text-green-700' : 'text-red-600'}>
                              {passCount} / {totalTests} pass
                            </span>
                          )
                          : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(p.createdAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(p.updatedAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {(p.status === 'draft' || p.status === 'tests_failed') && (
                            <button
                              disabled={isLoading}
                              onClick={() => void proposalAction(p.id, 'test')}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-40 transition-colors"
                            >
                              {loading[p.id] === 'test' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                              Test
                            </button>
                          )}
                          {p.status === 'awaiting_approval' && (
                            <>
                              <button
                                disabled={isLoading}
                                onClick={() => void proposalAction(p.id, 'approve')}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-40 transition-colors"
                              >
                                {loading[p.id] === 'approve' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                Approve
                              </button>
                              <button
                                disabled={isLoading}
                                onClick={() => void proposalAction(p.id, 'reject')}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40 transition-colors"
                              >
                                {loading[p.id] === 'reject' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
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
