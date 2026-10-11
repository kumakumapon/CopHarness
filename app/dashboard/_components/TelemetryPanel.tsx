'use client';

import {
  Zap,
} from 'lucide-react';
import type { TelemetryData } from './types';


// ---------------------------------------------------------------------------
// Section: Telemetry Panel
// ---------------------------------------------------------------------------

export function TelemetryPanel({ data }: { data: TelemetryData | undefined }) {
  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Zap className="w-4 h-4" /> テレメトリ (OpenTelemetry スパン)
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            直近 {data.total} 件
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.spans.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          スパンがありません。LLM を呼び出すとここに計装データが表示されます。<br />
          <span className="text-xs">OTEL_EXPORTER_OTLP_ENDPOINT を設定すると外部バックエンド（Jaeger 等）にエクスポートします。</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                {['スパン名', 'プロバイダ', 'モデル', '所要時間', 'ステータス', '開始時刻'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.spans.map((span, i) => {
                const isError = span.status === 'ERROR';
                return (
                  <tr
                    key={span.spanId}
                    style={{
                      background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                      borderBottom: i < data.spans.length - 1 ? '1px solid var(--border-color)' : undefined,
                    }}
                  >
                    <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {span.name}
                    </td>
                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {String(span.attributes['llm.provider'] ?? '—')}
                    </td>
                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {String(span.attributes['llm.model'] ?? '—')}
                    </td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {span.durationMs != null ? `${span.durationMs} ms` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {isError ? 'エラー' : 'OK'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(span.startTime).toLocaleString('ja-JP', { timeStyle: 'medium' })}
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
