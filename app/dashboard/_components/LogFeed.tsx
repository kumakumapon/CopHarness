'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Activity,
  ChevronRight,
  ArrowDown,
} from 'lucide-react';
import type { LogsData } from './types';
import { LogStatusBadge, fmtDate } from './shared';

const MAX_RESULT_DISPLAY_LENGTH = 500;


// ---------------------------------------------------------------------------
// Section: Activity Log Feed
// ---------------------------------------------------------------------------

const LOG_SCROLL_HEIGHT = 480;


export function LogFeed({ data }: { data: LogsData | undefined }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollTop(el.scrollTop > 80);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Scroll to top (newest) when fresh data arrives
  useEffect(() => {
    if (data && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [data]);

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Activity className="w-4 h-4" /> 実行ログ
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            直近 {data.logs.length} 件
          </span>
        )}
      </h2>

      {!data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
          ))}
        </div>
      ) : data.logs.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          実行ログがありません。スケジューラーを起動してください。
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
          <div
            ref={scrollRef}
            className="log-scroll-area overflow-y-auto"
            style={{ maxHeight: LOG_SCROLL_HEIGHT }}
          >
            {data.logs.map((log, i) => (
              <div key={log.id}
                style={{
                  background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                  borderBottom: i < data.logs.length - 1 ? '1px solid var(--border-color)' : undefined,
                }}
              >
                <button
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:brightness-95 transition-all"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <LogStatusBadge status={log.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        {log.scheduleName}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ background: 'var(--accent-warm)', color: 'var(--text-secondary)' }}>
                        {log.reason}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {fmtDate(log.startedAt)}
                      {log.finishedAt && (
                        <span> → {fmtDate(log.finishedAt)}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight
                    className={`w-4 h-4 shrink-0 transition-transform duration-200 ${expanded === log.id ? 'rotate-90' : ''}`}
                    style={{ color: 'var(--text-secondary)' }}
                  />
                </button>

                {expanded === log.id && (
                  <div className="px-4 pb-4 space-y-2 border-t"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--secondary-bg)' }}>
                    <div className="pt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>プロンプト: </span>
                      {log.prompt}
                    </div>
                    {log.result && (
                      <div className="text-xs rounded-lg p-3"
                        style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)' }}>
                        <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>結果</div>
                        <pre className="whitespace-pre-wrap font-sans leading-relaxed"
                          style={{ color: 'var(--text-secondary)' }}>
                          {log.result.slice(0, MAX_RESULT_DISPLAY_LENGTH)}
                          {log.result.length > MAX_RESULT_DISPLAY_LENGTH ? '…' : ''}
                        </pre>
                      </div>
                    )}
                    {log.error && (
                      <div className="text-xs rounded-lg p-3 bg-red-50 border border-red-200">
                        <div className="font-semibold mb-1 text-red-700">エラー</div>
                        <span className="text-red-600">{log.error}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Scroll-to-top button */}
          {showScrollTop && (
            <button
              onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full shadow-md transition-all hover:opacity-90"
              style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)' }}
            >
              <ArrowDown className="w-3 h-3 rotate-180" />
              最新へ
            </button>
          )}
        </div>
      )}
    </section>
  );
}
