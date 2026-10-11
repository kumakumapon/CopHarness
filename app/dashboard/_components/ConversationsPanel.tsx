'use client';

import {
  Trash2,
  Radio,
} from 'lucide-react';
import type { ConversationsData } from './types';
import { dashboardFetch } from './api';


// ---------------------------------------------------------------------------
// ConversationsPanel
// ---------------------------------------------------------------------------

export function ConversationsPanel({ data, onMutate }: { data: ConversationsData | undefined; onMutate: () => void }) {
  async function handleExport(key: string) {
    const res = await dashboardFetch(`/api/dashboard/conversations/${encodeURIComponent(key)}`);
    if (!res.ok) return;
    const json = await res.json() as unknown;
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${key.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(key: string) {
    if (!window.confirm(`Clear conversation "${key}"?`)) return;
    await dashboardFetch(`/api/dashboard/conversations/${encodeURIComponent(key)}`, { method: 'DELETE' });
    onMutate();
  }

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Radio className="w-4 h-4" /> Conversations
        {data && (
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>
            {data.conversations.length} session{data.conversations.length !== 1 ? 's' : ''}
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.conversations.length === 0 ? (
        <div
          className="rounded-xl p-4 text-center text-sm"
          style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
        >
          会話履歴はありません。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                {['Session Key', 'Messages', 'Last Updated', 'Export'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.conversations.map((conv, i) => (
                <tr
                  key={conv.key}
                  style={{
                    background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <td className="px-4 py-3 font-mono text-xs max-w-[260px] truncate" style={{ color: 'var(--text-primary)' }} title={conv.key}>
                    {conv.key.length > 40 ? `${conv.key.slice(0, 37)}…` : conv.key}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {conv.messageCount}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {conv.updatedAt ? new Date(conv.updatedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleExport(conv.key)}
                        className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
                        style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      >
                        Export
                      </button>
                      <button
                        onClick={() => void handleDelete(conv.key)}
                        className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
                        style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)', color: 'var(--color-danger, #ef4444)' }}
                        title="Clear conversation"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
