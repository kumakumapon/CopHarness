'use client';

import {
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Activity,
} from 'lucide-react';
import type { StatusData } from './types';
import { StatusBadge, fmtDate } from './shared';


// ---------------------------------------------------------------------------
// Section: Summary Banner
// ---------------------------------------------------------------------------

export function SummaryBanner({
  data,
  autoRefresh,
  onToggleAutoRefresh,
  onRefresh,
}: {
  data: StatusData | undefined;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      className="rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-4"
      style={{
        background: 'linear-gradient(135deg, var(--secondary-bg) 0%, var(--accent-peachy) 100%)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 2px 12px var(--shadow-light)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-secondary)' }}>
          CopHarness ダッシュボード
        </div>
        {data ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {data.activeProvider} / {data.activeModel}
            </span>
            <span className="text-sm px-3 py-1 rounded-full font-medium"
              style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)' }}>
              {data.configuredCount} / {data.totalCount} 設定済み
            </span>
          </div>
        ) : (
          <div className="h-6 w-48 rounded animate-pulse" style={{ background: 'var(--accent-warm)' }} />
        )}
        {data && (
          <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            最終更新: {fmtDate(data.checkedAt)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleAutoRefresh}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition-all hover:opacity-90 active:scale-95"
          style={{
            background: autoRefresh ? 'var(--accent-orange)' : 'var(--accent-warm)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {autoRefresh ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          自動更新
        </button>
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg transition-all hover:opacity-80 active:scale-95"
          style={{
            background: 'var(--accent-warm)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
          }}
          title="今すぐ更新"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Section: Status Cards
// ---------------------------------------------------------------------------

export function StatusCards({ data }: { data: StatusData | undefined }) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
        ))}
      </div>
    );
  }

  const all = [...data.providers, ...data.bots];
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Activity className="w-4 h-4" /> システム状態
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {all.map((c) => (
          <div
            key={c.name}
            className="rounded-xl p-4 flex items-start gap-3 transition-all duration-200 hover:shadow-md"
            style={{
              background: 'var(--secondary-bg)',
              border: `1px solid ${c.configured ? '#bbf7d0' : 'var(--border-color)'}`,
              boxShadow: c.configured ? '0 1px 4px rgba(134,239,172,0.15)' : undefined,
            }}
          >
            <StatusBadge configured={c.configured} />
            <div className="min-w-0">
              <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
              <div className="text-xs mt-0.5 font-medium" style={{ color: c.configured ? '#16a34a' : 'var(--text-secondary)' }}>
                {c.configured ? '設定済み' : '未設定'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
