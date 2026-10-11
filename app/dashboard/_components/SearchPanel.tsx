'use client';

import { useState } from 'react';
import {
  Activity,
} from 'lucide-react';
import { dashboardFetch } from './api';
import { fmtDate } from './shared';


// ---------------------------------------------------------------------------
// Section: Search Panel
// ---------------------------------------------------------------------------

interface SearchHit {
  id: string;
  type: 'conversation' | 'task';
  conversationKey?: string;
  role?: string;
  taskId?: string;
  title?: string;
  content: string;
  createdAt: string;
  snippet: string;
}


interface SearchData {
  hits: SearchHit[];
  total: number;
}


export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'conversation' | 'task'>('');
  const [submitted, setSubmitted] = useState<{ q: string; type: string } | null>(null);
  const [results, setResults] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSubmitted({ q, type: typeFilter });
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ q, limit: '20' });
      if (typeFilter) params.set('type', typeFilter);
      const res = await dashboardFetch(`/api/dashboard/search?${params.toString()}`);
      if (!res.ok) {
        setError(`エラー: ${res.status} ${res.statusText}`);
        setResults(null);
      } else {
        const data = await res.json() as SearchData;
        setResults(data);
      }
    } catch {
      setError('ネットワークエラー');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  const TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
    conversation: { bg: 'bg-blue-100', text: 'text-blue-700', label: '会話' },
    task:         { bg: 'bg-purple-100', text: 'text-purple-700', label: 'タスク' },
  };

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Activity className="w-4 h-4" /> 会話 / タスク検索
      </h2>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
        <form onSubmit={(e) => void handleSearch(e)} className="px-4 py-3 flex flex-wrap items-end gap-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            検索クエリ
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="キーワードを入力…"
              className="rounded px-3 py-1.5 text-sm outline-none focus:ring-2"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--accent-orange)' } as React.CSSProperties}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            種別
            <select
              className="rounded px-2 py-1.5 text-sm"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as '' | 'conversation' | 'task')}
            >
              <option value="">すべて</option>
              <option value="conversation">会話</option>
              <option value="task">タスク</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          >
            {loading ? '検索中…' : '検索'}
          </button>
        </form>

        {error && (
          <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-200">{error}</div>
        )}

        {!submitted && !results && (
          <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            キーワードを入力して会話メッセージやタスクを検索できます。
          </div>
        )}

        {results && results.hits.length === 0 && (
          <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            「{submitted?.q}」に一致する結果が見つかりませんでした。
          </div>
        )}

        {results && results.hits.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                <tr>
                  {['種別', 'スニペット', 'ID / Key', '日時'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.hits.map((hit) => {
                  const badge = TYPE_BADGE[hit.type] ?? TYPE_BADGE.conversation;
                  const ref = hit.type === 'conversation'
                    ? (hit.conversationKey ?? '—')
                    : (hit.taskId ?? '—');
                  return (
                    <tr key={hit.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                        {hit.role && (
                          <span className="ml-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{hit.role}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[480px]" style={{ color: 'var(--text-primary)' }}>
                        <div className="line-clamp-3 whitespace-pre-wrap break-words">{hit.snippet}</div>
                      </td>
                      <td className="px-3 py-2 font-mono max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }} title={ref}>
                        {ref}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(hit.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}>
              {results.total} 件ヒット
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
