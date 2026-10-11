'use client';

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { ApprovalsData } from './types';
import { dashboardFetch } from './api';


// ---------------------------------------------------------------------------
// Section: Approvals Panel
// ---------------------------------------------------------------------------

const APPROVAL_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending:  { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '承認待ち' },
  approved: { bg: 'bg-green-100',  text: 'text-green-700',  label: '承認済み' },
  rejected: { bg: 'bg-red-100',    text: 'text-red-700',    label: '拒否' },
  timeout:  { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'タイムアウト' },
};


export function ApprovalsPanel({
  data,
  onMutate,
}: {
  data: ApprovalsData | undefined;
  onMutate: () => void;
}) {
  const [loading, setLoading] = useState<Record<string, string>>({});

  async function resolve(id: string, action: 'approve' | 'reject') {
    setLoading((l) => ({ ...l, [id]: action }));
    await dashboardFetch(`/api/dashboard/approvals/${id}/${action}`, { method: 'POST' });
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[id]; return n; });
  }

  const pending = data?.approvals.filter((a) => a.status === 'pending') ?? [];
  const others = data?.approvals.filter((a) => a.status !== 'pending') ?? [];

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ShieldAlert className="w-4 h-4" /> 承認ゲート (Human-in-the-Loop)
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {pending.length > 0 && (
              <span className="inline-block px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 mr-1">
                待機中 {pending.length}
              </span>
            )}
            合計 {data.total}
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.approvals.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          承認待ちのリクエストはありません。<br />
          <span className="text-xs">HIL_ENABLED=true を設定するとリスク高スキルの実行前に承認が必要になります。</span>
        </div>
      ) : (
        <div className="space-y-2">
          {[...pending, ...others].map((req) => {
            const st = APPROVAL_STATUS_STYLES[req.status] ?? APPROVAL_STATUS_STYLES.pending;
            const isLoading = !!loading[req.id];
            return (
              <div
                key={req.id}
                className="rounded-xl p-4 flex flex-wrap items-start gap-3"
                style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${st.bg} ${st.text}`}>
                      {st.label}
                    </span>
                    <span className="font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {req.skillName}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(req.createdAt).toLocaleString('ja-JP')}
                    </span>
                  </div>
                  {req.preview && (
                    <div className="text-xs rounded p-3 mb-2 space-y-2"
                      style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>Dry-run preview</div>
                      <div>{req.preview.summary}</div>
                      {req.preview.command && <div className="font-mono">$ {req.preview.command}</div>}
                      {req.preview.targets?.length ? <div>Targets: {req.preview.targets.join(', ')}</div> : null}
                      {req.preview.riskAttributes?.length ? <div>Risk: {req.preview.riskAttributes.join(', ')}</div> : null}
                      {req.preview.unavailableReason && <div>Unavailable: {req.preview.unavailableReason}</div>}
                      {req.preview.diff && (
                        <pre className="font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">{req.preview.diff}</pre>
                      )}
                    </div>
                  )}
                  <div className="text-xs rounded p-2 font-mono overflow-x-auto"
                    style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(req.args, null, 2)}
                  </div>
                </div>
                {req.status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      disabled={isLoading}
                      onClick={() => resolve(req.id, 'approve')}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-40 transition-colors"
                    >
                      {loading[req.id] === 'approve' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                      承認
                    </button>
                    <button
                      disabled={isLoading}
                      onClick={() => resolve(req.id, 'reject')}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40 transition-colors"
                    >
                      {loading[req.id] === 'reject' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                      拒否
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
