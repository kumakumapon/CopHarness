'use client';

import {
  Wrench,
} from 'lucide-react';
import type { ToolsetSkillEntry, ToolsetsData } from './types';


// ---------------------------------------------------------------------------
// ToolsetsPanel
// ---------------------------------------------------------------------------

export function ToolsetsPanel({ data }: { data: ToolsetsData | undefined }) {
  const riskColor = (level: string) => {
    if (level === 'high') return 'text-red-500';
    if (level === 'medium') return 'text-yellow-600';
    return 'text-green-600';
  };

  function riskBreakdown(skills: ToolsetSkillEntry[]) {
    const registered = skills.filter((s) => s.registered);
    const low = registered.filter((s) => s.riskLevel === 'low').length;
    const med = registered.filter((s) => s.riskLevel === 'medium').length;
    const high = registered.filter((s) => s.riskLevel === 'high').length;
    return [
      low > 0 ? `low ${low}` : null,
      med > 0 ? `med ${med}` : null,
      high > 0 ? `high ${high}` : null,
    ]
      .filter(Boolean)
      .join(' / ') || '—';
  }

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Wrench className="w-4 h-4" /> Toolsets / MCP Hub
      </h2>

      {!data ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : (
        <>
          {/* Toolsets table */}
          <div className="overflow-x-auto rounded-xl mb-4" style={{ border: '1px solid var(--border-color)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                  {['名前', 'ソース', 'スキル数', 'リスク内訳', 'スキル一覧'].map((h) => (
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
                {data.toolsets.map((ts, i) => (
                  <tr
                    key={ts.name}
                    style={{
                      background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                      <div>{ts.name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{ts.description}</div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ts.source === 'custom' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {ts.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {ts.skillCount}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {riskBreakdown(ts.skills)}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[320px]">
                      <div className="flex flex-wrap gap-1">
                        {ts.skills.map((s) => (
                          <span
                            key={s.name}
                            className={`inline-block px-1.5 py-0.5 rounded font-mono text-xs ${s.registered ? '' : 'opacity-40 line-through'} ${s.active ? '' : 'opacity-60'}`}
                            style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}
                            title={`${s.riskLevel}${s.registered ? '' : ' (unregistered)'}${s.active ? '' : ' (inactive)'}`}
                          >
                            <span className={riskColor(s.riskLevel)}>●</span> {s.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MCP servers table */}
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-secondary)' }}>
            MCP Servers
          </h3>
          {data.mcpServers.length === 0 ? (
            <div
              className="rounded-xl p-4 text-center text-sm"
              style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            >
              MCP サーバーは登録されていません。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                    {['名前', 'URL', 'ツール数', 'フィルタ', 'エラー'].map((h) => (
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
                  {data.mcpServers.map((srv, i) => (
                    <tr
                      key={srv.name}
                      style={{
                        background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                        borderBottom: '1px solid var(--border-color)',
                      }}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {srv.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs truncate max-w-[200px]" style={{ color: 'var(--text-secondary)' }} title={srv.url}>
                        {srv.url}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {srv.toolCount}
                        {srv.skippedToolNames.length > 0 && (
                          <span className="ml-1 text-yellow-600" title={`Skipped: ${srv.skippedToolNames.join(', ')}`}>
                            (+{srv.skippedToolNames.length} skipped)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {srv.includeTools && <div>include: {srv.includeTools.join(', ')}</div>}
                        {srv.excludeTools && <div>exclude: {srv.excludeTools.join(', ')}</div>}
                        {!srv.includeTools && !srv.excludeTools && '—'}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[200px] truncate" style={{ color: srv.error ? 'var(--color-danger, #ef4444)' : 'var(--text-secondary)' }} title={srv.error}>
                        {srv.error ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
