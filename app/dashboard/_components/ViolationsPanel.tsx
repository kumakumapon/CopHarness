'use client';

import {
  AlertTriangle,
} from 'lucide-react';
import type { ViolationsData } from './types';


// ---------------------------------------------------------------------------
// Section: Schema Violations Panel
// ---------------------------------------------------------------------------

export function ViolationsPanel({ data }: { data: ViolationsData | undefined }) {
  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <AlertTriangle className="w-4 h-4 text-amber-500" /> スキーマ違反ログ
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            累計 {data.total} 件
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.violations.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          スキーマ違反はありません。outputSchema を持つスキルの出力が不正な場合ここに記録されます。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                {['スキル', '違反内容', 'コンテンツ（抜粋）', '日時'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.violations.map((v, i) => (
                <tr
                  key={v.id}
                  style={{
                    background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                    borderBottom: i < data.violations.length - 1 ? '1px solid var(--border-color)' : undefined,
                  }}
                >
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                    {v.skillName}
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)', maxWidth: '280px' }}>
                    <ul className="list-disc list-inside space-y-0.5">
                      {v.errors.map((e, ei) => <li key={ei}>{e}</li>)}
                    </ul>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)', maxWidth: '200px', wordBreak: 'break-all' }}>
                    {v.contentPreview || '—'}
                  </td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(v.timestamp).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'medium' })}
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
