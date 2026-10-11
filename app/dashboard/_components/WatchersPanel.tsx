'use client';

import { useState } from 'react';
import {
  RefreshCw,
  Play,
  ToggleLeft,
  ToggleRight,
  Radio,
} from 'lucide-react';
import type { Watcher, WatchersData } from './types';
import { dashboardFetch } from './api';
import { fmtDate } from './shared';


// ---------------------------------------------------------------------------
// Section: Watchers Panel
// ---------------------------------------------------------------------------

export function WatchersPanel({ data, onMutate }: { data: WatchersData | undefined; onMutate: () => void }) {
  const [loading, setLoading] = useState<Record<string, string>>({});

  async function apiCall(url: string, method: string, body?: object) {
    const res = await dashboardFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  }

  async function toggleEnabled(watcher: Watcher) {
    setLoading((l) => ({ ...l, [watcher.id]: 'toggle' }));
    await apiCall(`/api/dashboard/watchers/${watcher.id}`, 'PATCH', { enabled: !watcher.enabled });
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[watcher.id]; return n; });
  }

  async function trigger(watcher: Watcher) {
    setLoading((l) => ({ ...l, [watcher.id]: 'trigger' }));
    await apiCall(`/api/dashboard/watchers/${watcher.id}/trigger`, 'POST', {
      source: 'dashboard',
      type: 'manual',
      subject: watcher.name,
    });
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[watcher.id]; return n; });
  }

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Radio className="w-4 h-4" /> Watchers
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.watchers.filter((watcher) => watcher.enabled).length} / {data.watchers.length} 件有効
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.watchers.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
          Watcher はまだ登録されていません。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                {['名前', '種別', '条件', '最終発火', '回数', '状態', '操作'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.watchers.map((watcher, i) => {
                const isLoading = !!loading[watcher.id];
                return (
                  <tr
                    key={watcher.id}
                    style={{
                      background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                      <div>{watcher.name}</div>
                      <div className="text-xs font-mono truncate max-w-[220px]" style={{ color: 'var(--text-secondary)' }} title={watcher.prompt}>
                        {watcher.prompt}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{watcher.type}</td>
                    <td className="px-4 py-3 font-mono text-xs max-w-[180px] truncate" style={{ color: 'var(--text-secondary)' }}>{watcher.eventPattern || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(watcher.lastTriggeredAt)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{watcher.triggerCount}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${watcher.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {watcher.enabled ? '有効' : '無効'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          disabled={isLoading}
                          onClick={() => toggleEnabled(watcher)}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
                          style={{ background: 'var(--accent-warm)' }}
                          title={watcher.enabled ? '無効化' : '有効化'}
                        >
                          {watcher.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        <button
                          disabled={isLoading || !watcher.enabled}
                          onClick={() => trigger(watcher)}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
                          style={{ background: 'var(--accent-peachy)' }}
                          title="手動発火"
                        >
                          {loading[watcher.id] === 'trigger' ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
