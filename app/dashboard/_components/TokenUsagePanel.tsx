'use client';

import {
  Activity,
} from 'lucide-react';
import type { TokenUsageData } from './types';
import { fmtDate } from './shared';


// ---------------------------------------------------------------------------
// Section: Token Usage Panel
// ---------------------------------------------------------------------------

export function TokenUsagePanel({ data }: { data: TokenUsageData | undefined }) {
  function fmtNum(n: number): string {
    return n.toLocaleString();
  }

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Activity className="w-4 h-4" /> トークン使用量
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.usage.length} プロバイダ/モデル
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.usage.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          トークン使用量データがありません。LLM を呼び出すとここに累積トークン数が表示されます。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                {['プロバイダ', 'モデル', 'プロンプトトークン', '補完トークン', '合計トークン', 'リクエスト数', '最終使用'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.usage.map((entry, i) => (
                <tr
                  key={`${entry.provider}:${entry.model}`}
                  style={{
                    background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                    borderBottom: i < data.usage.length - 1 ? '1px solid var(--border-color)' : undefined,
                  }}
                >
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                    {entry.provider}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {entry.model}
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {fmtNum(entry.totalPromptTokens)}
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {fmtNum(entry.totalCompletionTokens)}
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {fmtNum(entry.totalTokens)}
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {fmtNum(entry.requestCount)}
                  </td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {fmtDate(entry.lastSeenAt)}
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
