'use client';

import useSWR, { mutate } from 'swr';
import { useState } from 'react';
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
}

interface SkillsData {
  skills: Skill[];
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
    <div className="rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-4"
      style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
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
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: autoRefresh ? 'var(--accent-orange)' : 'var(--accent-warm)',
            color: 'var(--text-primary)',
          }}
        >
          {autoRefresh ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          自動更新
        </button>
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg transition-colors hover:opacity-80"
          style={{ background: 'var(--accent-warm)', color: 'var(--text-primary)' }}
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
            className="rounded-xl p-4 flex items-start gap-3 transition-shadow"
            style={{
              background: 'var(--secondary-bg)',
              border: `1px solid ${c.configured ? '#bbf7d0' : 'var(--border-color)'}`,
            }}
          >
            <StatusBadge configured={c.configured} />
            <div className="min-w-0">
              <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
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

function LogFeed({ data }: { data: LogsData | undefined }) {
  const [expanded, setExpanded] = useState<string | null>(null);

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
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
          {data.logs.map((log, i) => (
            <div key={log.id}
              style={{
                background: i % 2 === 0 ? 'var(--primary-bg)' : 'var(--secondary-bg)',
                borderBottom: i < data.logs.length - 1 ? '1px solid var(--border-color)' : undefined,
              }}
            >
              <button
                className="w-full text-left px-4 py-3 flex items-center gap-3"
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              >
                <LogStatusBadge status={log.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {log.scheduleName}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-warm)', color: 'var(--text-secondary)' }}>
                      {log.reason}
                    </span>
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                    {fmtDate(log.startedAt)}
                    {log.finishedAt && ` → ${fmtDate(log.finishedAt)}`}
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${expanded === log.id ? 'rotate-90' : ''}`}
                  style={{ color: 'var(--text-secondary)' }} />
              </button>
              {expanded === log.id && (
                <div className="px-4 pb-4 text-xs space-y-2" style={{ color: 'var(--text-secondary)' }}>
                  <div>
                    <span className="font-semibold">プロンプト: </span>
                    <span>{log.prompt}</span>
                  </div>
                  {log.result && (
                    <div>
                      <span className="font-semibold">結果: </span>
                      <span className="whitespace-pre-wrap">{log.result.slice(0, MAX_RESULT_DISPLAY_LENGTH)}{log.result.length > MAX_RESULT_DISPLAY_LENGTH ? '…' : ''}</span>
                    </div>
                  )}
                  {log.error && (
                    <div className="text-red-600">
                      <span className="font-semibold">エラー: </span>
                      <span>{log.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Skills Panel
// ---------------------------------------------------------------------------

function SkillsPanel({ data }: { data: SkillsData | undefined }) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Wrench className="w-4 h-4" /> スキル一覧
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.skills.length} 件
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
          {data.skills.map((skill) => (
            <div key={skill.name} className="rounded-xl p-4"
              style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
              <div className="font-mono font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{skill.name}</div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{skill.description}</div>
            </div>
          ))}
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

  function refreshAll() {
    void mutateStatus();
    void mutateSchedules();
    void mutateLogs();
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
        <SkillsPanel data={skillsData} />
      </div>
    </div>
  );
}
