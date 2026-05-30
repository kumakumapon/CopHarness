'use client';

import useSWR, { mutate } from 'swr';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Play,
  Square,
  ToggleLeft,
  ToggleRight,
  Clock,
  Wrench,
  Activity,
  ChevronRight,
  ArrowDown,
  ShieldAlert,
  Zap,
  AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters of a schedule result to display in the log feed. */
const MAX_RESULT_DISPLAY_LENGTH = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderStatus {
  name: string;
  configured: boolean;
  detail?: string;
}

interface StatusData {
  activeProvider: string;
  activeModel: string;
  configuredCount: number;
  totalCount: number;
  providers: ProviderStatus[];
  bots: ProviderStatus[];
  checkedAt: string;
}

interface Schedule {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string | null;
  runNow?: boolean;
  stopRequested?: boolean;
}

interface SchedulesData {
  schedules: Schedule[];
}

interface LogEntry {
  id: string;
  scheduleId: string;
  scheduleName: string;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  status?: 'success' | 'failed' | 'aborted';
  result?: string;
  error?: string;
  reason: string;
}

interface LogsData {
  logs: LogEntry[];
}

interface Skill {
  name: string;
  description: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresEnv: string[];
  enabled: boolean;
}

interface SkillsData {
  skills: Skill[];
}

interface ApprovalRequest {
  id: string;
  skillName: string;
  args: Record<string, unknown>;
  createdAt: number;
  resolvedAt?: number;
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  requestedBy?: string;
}

interface ApprovalsData {
  approvals: ApprovalRequest[];
  total: number;
}

interface TelemetrySpan {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'UNSET' | 'OK' | 'ERROR';
  statusMessage?: string;
}

interface TelemetryData {
  spans: TelemetrySpan[];
  total: number;
}

interface SchemaViolation {
  id: string;
  skillName: string;
  timestamp: string;
  errors: string[];
  contentPreview: string;
}

interface ViolationsData {
  violations: SchemaViolation[];
  total: number;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
  ) : (
    <XCircle className="w-5 h-5 text-red-400 shrink-0" />
  );
}

function LogStatusBadge({ status }: { status?: string }) {
  if (!status) {
    return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">実行中</span>;
  }
  const map: Record<string, string> = {
    success: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    aborted: 'bg-gray-100 text-gray-600',
  };
  const labelMap: Record<string, string> = {
    success: '成功',
    failed: '失敗',
    aborted: '中断',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labelMap[status] ?? status}
    </span>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// Section: Summary Banner
// ---------------------------------------------------------------------------

function SummaryBanner({
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

function StatusCards({ data }: { data: StatusData | undefined }) {
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

// ---------------------------------------------------------------------------
// Section: Scheduler Panel
// ---------------------------------------------------------------------------

function SchedulerPanel({ data, onMutate }: { data: SchedulesData | undefined; onMutate: () => void }) {
  const [loading, setLoading] = useState<Record<string, string>>({});

  async function apiCall(url: string, method: string, body?: object) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    setLoading((l) => ({ ...l, [id]: 'toggle' }));
    await apiCall(`/api/dashboard/schedules/${id}`, 'PATCH', { enabled });
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[id]; return n; });
  }

  async function fireSchedule(id: string) {
    setLoading((l) => ({ ...l, [id]: 'fire' }));
    await apiCall(`/api/dashboard/schedules/${id}/fire`, 'POST');
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[id]; return n; });
  }

  async function stopSchedule(id: string) {
    setLoading((l) => ({ ...l, [id]: 'stop' }));
    await apiCall(`/api/dashboard/schedules/${id}/stop`, 'POST');
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[id]; return n; });
  }

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Clock className="w-4 h-4" /> スケジューラー
        {data && (
          <span className="ml-auto text-xs font-normal normal-case"
            style={{ color: 'var(--text-secondary)' }}>
            {data.schedules.length} 件
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-32 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.schedules.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          スケジュールが登録されていません。<br />
          <code className="text-xs">npm run schedule add</code> で追加できます。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--secondary-bg)', borderBottom: '1px solid var(--border-color)' }}>
                {['名前', 'Cron', '最終実行', '次回実行', '状態', '操作'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.schedules.map((s, i) => {
                const isLoading = !!loading[s.id];
                return (
                  <tr
                    key={s.id}
                    style={{
                      background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                      <div>{s.name}</div>
                      <div className="text-xs font-mono truncate max-w-[180px]"
                        style={{ color: 'var(--text-secondary)' }}
                        title={s.prompt}>{s.prompt}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{s.cron}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(s.lastRun)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(s.nextRun ?? undefined)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.enabled ? '有効' : '無効'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          disabled={isLoading}
                          onClick={() => toggleEnabled(s.id, !s.enabled)}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
                          style={{ background: 'var(--accent-warm)' }}
                          title={s.enabled ? '無効化' : '有効化'}
                        >
                          {s.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        <button
                          disabled={isLoading || !s.enabled}
                          onClick={() => fireSchedule(s.id)}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
                          style={{ background: 'var(--accent-peachy)' }}
                          title="即時実行"
                        >
                          {loading[s.id] === 'fire' ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          disabled={isLoading}
                          onClick={() => stopSchedule(s.id)}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
                          style={{ background: 'var(--accent-warm)' }}
                          title="実行中断"
                        >
                          {loading[s.id] === 'stop' ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Square className="w-4 h-4" />
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

// ---------------------------------------------------------------------------
// Section: Activity Log Feed
// ---------------------------------------------------------------------------

const LOG_SCROLL_HEIGHT = 480;

function LogFeed({ data }: { data: LogsData | undefined }) {
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

// ---------------------------------------------------------------------------
// Section: Skills Panel
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  utility: 'ユーティリティ',
  file: 'ファイル',
  web: 'Web',
  system: 'システム',
  memory: 'メモリ',
  external: '外部API',
};

const RISK_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low:    { bg: 'bg-green-100', text: 'text-green-700', label: '低' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '中' },
  high:   { bg: 'bg-red-100',   text: 'text-red-700',   label: '高' },
};

function SkillsPanel({ data }: { data: SkillsData | undefined }) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Wrench className="w-4 h-4" /> スキル一覧
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.skills.filter((s) => s.enabled).length} / {data.skills.length} 件有効
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.skills.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          登録済みスキルがありません。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.skills.map((skill) => {
            const risk = RISK_STYLES[skill.riskLevel] ?? RISK_STYLES.low;
            const categoryLabel = CATEGORY_LABELS[skill.category] ?? skill.category;
            return (
              <div key={skill.name} className="rounded-xl p-4 flex flex-col gap-2"
                style={{
                  background: 'var(--secondary-bg)',
                  border: `1px solid ${skill.enabled ? '#bbf7d0' : 'var(--border-color)'}`,
                  opacity: skill.enabled ? 1 : 0.6,
                }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{skill.name}</div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${skill.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {skill.enabled ? '有効' : '無効'}
                    </span>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${risk.bg} ${risk.text}`}>
                      リスク: {risk.label}
                    </span>
                  </div>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{skill.description}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                    style={{ background: 'var(--accent-warm)', color: 'var(--text-secondary)' }}>
                    {categoryLabel}
                  </span>
                  {skill.requiresEnv.map((env) => (
                    <span key={env} className="inline-block px-1.5 py-0.5 rounded text-xs font-mono"
                      style={{ background: 'var(--accent-peachy)', color: 'var(--text-secondary)' }}>
                      {env}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Approvals Panel
// ---------------------------------------------------------------------------

const APPROVAL_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending:  { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '承認待ち' },
  approved: { bg: 'bg-green-100',  text: 'text-green-700',  label: '承認済み' },
  rejected: { bg: 'bg-red-100',    text: 'text-red-700',    label: '拒否' },
  timeout:  { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'タイムアウト' },
};

function ApprovalsPanel({
  data,
  onMutate,
}: {
  data: ApprovalsData | undefined;
  onMutate: () => void;
}) {
  const [loading, setLoading] = useState<Record<string, string>>({});

  async function resolve(id: string, action: 'approve' | 'reject') {
    setLoading((l) => ({ ...l, [id]: action }));
    await fetch(`/api/dashboard/approvals/${id}/${action}`, { method: 'POST' });
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

// ---------------------------------------------------------------------------
// Section: Telemetry Panel
// ---------------------------------------------------------------------------

function TelemetryPanel({ data }: { data: TelemetryData | undefined }) {
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

// ---------------------------------------------------------------------------
// Section: Schema Violations Panel
// ---------------------------------------------------------------------------

function ViolationsPanel({ data }: { data: ViolationsData | undefined }) {
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

// ---------------------------------------------------------------------------
// Main Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshInterval = autoRefresh ? 30_000 : 0;

  const { data: statusData, mutate: mutateStatus } =
    useSWR<StatusData>('/api/dashboard/status', fetcher, { refreshInterval });
  const { data: schedulesData, mutate: mutateSchedules } =
    useSWR<SchedulesData>('/api/dashboard/schedules', fetcher, { refreshInterval });
  const { data: logsData, mutate: mutateLogs } =
    useSWR<LogsData>('/api/dashboard/logs?limit=20', fetcher, { refreshInterval });
  const { data: skillsData } =
    useSWR<SkillsData>('/api/dashboard/skills', fetcher);
  const { data: approvalsData, mutate: mutateApprovals } =
    useSWR<ApprovalsData>('/api/dashboard/approvals', fetcher, { refreshInterval: 3_000 });
  const { data: telemetryData } =
    useSWR<TelemetryData>('/api/dashboard/telemetry?limit=50', fetcher, { refreshInterval });
  const { data: violationsData } =
    useSWR<ViolationsData>('/api/dashboard/violations?limit=50', fetcher, { refreshInterval });

  function refreshAll() {
    void mutateStatus();
    void mutateSchedules();
    void mutateLogs();
    void mutateApprovals();
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--primary-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <SummaryBanner
          data={statusData}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
          onRefresh={refreshAll}
        />
        <StatusCards data={statusData} />
        <SchedulerPanel data={schedulesData} onMutate={() => { void mutateSchedules(); void mutateLogs(); }} />
        <LogFeed data={logsData} />
        <ApprovalsPanel data={approvalsData} onMutate={() => void mutateApprovals()} />
        <TelemetryPanel data={telemetryData} />
        <ViolationsPanel data={violationsData} />
        <SkillsPanel data={skillsData} />
      </div>
    </div>
  );
}
