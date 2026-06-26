'use client';

import useSWR, { mutate } from 'swr';
import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
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
  Plus,
  Trash2,
  Pencil,
  X,
  Radio,
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
  discordChannelId?: string;
  lineUserId?: string;
}

interface SchedulesData {
  schedules: Schedule[];
}

interface Watcher {
  id: string;
  name: string;
  type: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
  eventPattern?: string;
  discordChannelId?: string;
  lineUserId?: string;
}

interface WatchersData {
  watchers: Watcher[];
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

interface SkillExecutionMetrics {
  skillName: string;
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  exceptionRuns: number;
  successRate: number | null;
  averageDurationMs: number | null;
  lastRunAt?: string;
  lastStatus?: 'success' | 'error' | 'exception';
  lastErrorPreview?: string;
}

interface SkillApprovalPolicy {
  mode: 'alwaysAllow' | 'allowWithDryRun' | 'requireApproval' | 'deny' | 'allowForSession';
  decision: 'allowed' | 'dry_run_allowed' | 'approval_required' | 'denied';
  ruleId?: string;
  reason: string;
}

interface Skill {
  name: string;
  description: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresEnv: string[];
  enabled: boolean;
  approvalPolicy?: SkillApprovalPolicy;
  metrics: SkillExecutionMetrics;
}

interface SkillsData {
  skills: Skill[];
}

interface SkillExecutionRecord {
  id: string;
  skillName: string;
  personId?: string;
  channelKey?: string;
  taskId?: string;
  approvalId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'success' | 'error' | 'exception';
  riskLevel?: 'low' | 'medium' | 'high';
  argsPreview: string;
  resultPreview?: string;
  errorPreview?: string;
}

interface SkillExecutionsData {
  executions: SkillExecutionRecord[];
  total: number;
}

interface SkillExecutionFilters {
  status: '' | 'success' | 'error' | 'exception';
  riskLevel: '' | 'low' | 'medium' | 'high';
  personQuery: string;
  channelQuery: string;
  taskQuery: string;
  from: string;
  to: string;
}

interface DashboardTask {
  id: string;
  kind: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  personId?: string;
  channelKey?: string;
  conversationKey?: string;
  title?: string;
  createdAt?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  errorPreview?: string;
  metadata?: Record<string, unknown>;
}

interface DashboardAgentDagPlan {
  id: string;
  role: string;
  prompt?: string;
  dependsOn?: string[];
  skills?: string[];
  timeoutMs?: number;
  workspace?: string;
}

interface DashboardAgentDagProgress {
  planId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface DashboardAgentDag {
  runId: string;
  status: 'running' | 'succeeded' | 'failed';
  plans: DashboardAgentDagPlan[];
  progress: DashboardAgentDagProgress[];
  updatedAt?: string;
}

interface TasksData {
  tasks: DashboardTask[];
  total: number;
}

interface TaskFilters {
  status: '' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  kindQuery: string;
  personQuery: string;
  channelQuery: string;
  from: string;
  to: string;
}

interface DashboardChannelIdentity {
  channel: string;
  subject: string;
  channelKey: string;
  displayName?: string;
  updatedAt: string;
}

interface DashboardPerson {
  personId: string;
  displayName?: string;
  updatedAt: string;
  channelKeys: string[];
  channelIdentities: DashboardChannelIdentity[];
  channelCount: number;
  taskCount: number;
  runningTaskCount: number;
  recentTasks: DashboardTask[];
}

interface IdentitiesData {
  people: DashboardPerson[];
  total: number;
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

interface TokenUsageSummaryEntry {
  provider: string;
  model: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requestCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface TokenUsageData {
  usage: TokenUsageSummaryEntry[];
}

interface SkillProposalTestResult {
  index: number;
  passed: boolean;
  detail?: string;
}

interface DashboardSkillProposal {
  id: string;
  name: string;
  description: string;
  problem: string;
  riskLevel: 'low' | 'medium' | 'high';
  status:
    | 'draft'
    | 'testing'
    | 'tests_failed'
    | 'awaiting_approval'
    | 'approved'
    | 'rejected'
    | 'registered';
  testResults?: SkillProposalTestResult[];
  createdAt: string;
  updatedAt: string;
}

interface SkillProposalsData {
  proposals: DashboardSkillProposal[];
  total: number;
}

type SkillProposalStatusFilter =
  | ''
  | 'draft'
  | 'testing'
  | 'tests_failed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'registered';

interface ToolsetSkillEntry {
  name: string;
  riskLevel: 'low' | 'medium' | 'high';
  active: boolean;
  registered: boolean;
}

interface ToolsetEntry {
  name: string;
  description: string;
  source: 'builtin' | 'custom';
  skillCount: number;
  skills: ToolsetSkillEntry[];
}

interface McpServerEntry {
  name: string;
  url: string;
  toolCount: number;
  loadedToolNames: string[];
  skippedToolNames: string[];
  includeTools?: string[];
  excludeTools?: string[];
  loadedAt: string;
  error?: string;
}

interface ToolsetsData {
  toolsets: ToolsetEntry[];
  mcpServers: McpServerEntry[];
}

interface ConversationEntry {
  key: string;
  messageCount: number;
  updatedAt: number;
}

interface ConversationsData {
  conversations: ConversationEntry[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

const DASHBOARD_API_KEY_STORAGE = 'copharness.dashboardApiKey';

function getDashboardApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(DASHBOARD_API_KEY_STORAGE);
}

async function dashboardFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  const apiKey = getDashboardApiKey();
  if (apiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }

  const res = await fetch(input, { ...init, headers });
  if (res.status !== 401 || !retry || typeof window === 'undefined') return res;

  const nextKey = window.prompt('Dashboard API key');
  if (!nextKey) return res;
  window.localStorage.setItem(DASHBOARD_API_KEY_STORAGE, nextKey);
  return dashboardFetch(input, init, false);
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await dashboardFetch(url);
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
// Section: Schedule Form Modal
// ---------------------------------------------------------------------------

interface ScheduleFormValues {
  name: string;
  cron: string;
  prompt: string;
  discordChannelId: string;
  lineUserId: string;
}

function ScheduleFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit';
  initial?: Schedule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<ScheduleFormValues>({
    name: initial?.name ?? '',
    cron: initial?.cron ?? '',
    prompt: initial?.prompt ?? '',
    discordChannelId: initial?.discordChannelId ?? '',
    lineUserId: initial?.lineUserId ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function set(field: keyof ScheduleFormValues, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.name.trim()) { setError('名前は必須です'); return; }
    if (!values.cron.trim()) { setError('タイミングは必須です'); return; }
    if (!values.prompt.trim()) { setError('プロンプトは必須です'); return; }
    setError('');
    setSaving(true);
    try {
      const body = {
        name: values.name.trim(),
        cron: values.cron.trim(),
        prompt: values.prompt.trim(),
        discordChannelId: values.discordChannelId.trim() || undefined,
        lineUserId: values.lineUserId.trim() || undefined,
      };
      const res = mode === 'add'
        ? await dashboardFetch('/api/dashboard/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await dashboardFetch(`/api/dashboard/schedules/${initial!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? '保存に失敗しました');
      } else {
        onSaved();
        onClose();
      }
    } catch {
      setError('ネットワークエラー');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
        style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {mode === 'add' ? 'スケジュール追加' : 'スケジュール編集'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>名前 *</label>
            <input
              type="text"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Morning standup"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--accent-orange)' } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>タイミング * <span className="font-normal">(例: 09:00 / 0 9 * * * / 毎日朝9時)</span></label>
            <input
              type="text"
              value={values.cron}
              onChange={(e) => set('cron', e.target.value)}
              placeholder="09:00"
              className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--accent-orange)' } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>プロンプト *</label>
            <textarea
              value={values.prompt}
              onChange={(e) => set('prompt', e.target.value)}
              placeholder="今日のタスクを提案して"
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 resize-none"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--accent-orange)' } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Discord チャンネル ID <span className="font-normal">(任意)</span></label>
            <input
              type="text"
              value={values.discordChannelId}
              onChange={(e) => set('discordChannelId', e.target.value)}
              placeholder="123456789012345678"
              className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--accent-orange)' } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>LINE ユーザー ID <span className="font-normal">(任意)</span></label>
            <input
              type="text"
              value={values.lineUserId}
              onChange={(e) => set('lineUserId', e.target.value)}
              placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--accent-orange)' } as React.CSSProperties}
            />
          </div>
          {error && (
            <div className="rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: 'var(--accent-warm)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              {saving ? '保存中…' : mode === 'add' ? '追加' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Scheduler Panel
// ---------------------------------------------------------------------------

function SchedulerPanel({ data, onMutate }: { data: SchedulesData | undefined; onMutate: () => void }) {
  const [loading, setLoading] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; schedule?: Schedule } | null>(null);

  async function apiCall(url: string, method: string, body?: object) {
    const res = await dashboardFetch(url, {
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

  async function deleteSchedule(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    setLoading((l) => ({ ...l, [id]: 'delete' }));
    await apiCall(`/api/dashboard/schedules/${id}`, 'DELETE');
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[id]; return n; });
  }

  return (
    <section className="mb-6">
      {modal && (
        <ScheduleFormModal
          mode={modal.mode}
          initial={modal.schedule}
          onClose={() => setModal(null)}
          onSaved={() => { onMutate(); setModal(null); }}
        />
      )}
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}>
        <Clock className="w-4 h-4" /> スケジューラー
        {data && (
          <span className="text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.schedules.length} 件
          </span>
        )}
        <button
          onClick={() => setModal({ mode: 'add' })}
          className="ml-auto flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-90 active:scale-95 normal-case"
          style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
        >
          <Plus className="w-3.5 h-3.5" /> スケジュール追加
        </button>
      </h2>

      {!data ? (
        <div className="h-32 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.schedules.length === 0 ? (
        <div className="rounded-xl p-8 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
          <Clock className="w-8 h-8 mx-auto mb-3 opacity-30" />
          スケジュールが登録されていません。
          <div className="mt-3">
            <button
              onClick={() => setModal({ mode: 'add' })}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <Plus className="w-4 h-4" /> スケジュールを追加する
            </button>
          </div>
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
                        <button
                          disabled={isLoading}
                          onClick={() => setModal({ mode: 'edit', schedule: s })}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
                          style={{ background: 'var(--accent-warm)' }}
                          title="編集"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          disabled={isLoading}
                          onClick={() => void deleteSchedule(s.id, s.name)}
                          className="p-1.5 rounded-lg transition-colors hover:opacity-80 disabled:opacity-40"
                          style={{ background: '#fee2e2', color: '#dc2626' }}
                          title="削除"
                        >
                          {loading[s.id] === 'delete' ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
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
// Section: Watchers Panel
// ---------------------------------------------------------------------------

function WatchersPanel({ data, onMutate }: { data: WatchersData | undefined; onMutate: () => void }) {
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

const APPROVAL_POLICY_LABELS: Record<string, string> = {
  alwaysAllow: '常に許可',
  allowForSession: 'セッション許可',
  allowWithDryRun: 'Dry-run許可',
  requireApproval: '承認必須',
  deny: '拒否',
};

function SkillsPanel({
  data,
  executionsData,
  executionFilters,
  onExecutionFiltersChange,
}: {
  data: SkillsData | undefined;
  executionsData: SkillExecutionsData | undefined;
  executionFilters: SkillExecutionFilters;
  onExecutionFiltersChange: (filters: SkillExecutionFilters) => void;
}) {
  const updateFilter = (key: keyof SkillExecutionFilters, value: string) => {
    onExecutionFiltersChange({ ...executionFilters, [key]: value });
  };

  const clearFilters = () => {
    onExecutionFiltersChange({ status: '', riskLevel: '', personQuery: '', channelQuery: '', taskQuery: '', from: '', to: '' });
  };

  const hasActiveFilters = Object.values(executionFilters).some(Boolean);
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
                {skill.approvalPolicy && (
                  <div className="text-[11px] rounded px-2 py-1" style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                    承認ポリシー: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{APPROVAL_POLICY_LABELS[skill.approvalPolicy.mode] ?? skill.approvalPolicy.mode}</span>
                    {skill.approvalPolicy.ruleId ? <span className="ml-1 font-mono">({skill.approvalPolicy.ruleId})</span> : null}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 rounded-lg p-2 text-xs" style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)' }}>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{skill.metrics.totalRuns}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>実行</div>
                  </div>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {skill.metrics.successRate == null ? '—' : `${Math.round(skill.metrics.successRate * 100)}%`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>成功率</div>
                  </div>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {skill.metrics.averageDurationMs == null ? '—' : `${skill.metrics.averageDurationMs}ms`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>平均</div>
                  </div>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  最終実行: {skill.metrics.lastRunAt ? fmtDate(skill.metrics.lastRunAt) : '—'}
                  {skill.metrics.lastStatus && (
                    <span className="ml-2">
                      ({skill.metrics.lastStatus === 'success' ? '成功' : skill.metrics.lastStatus === 'error' ? 'エラー結果' : '例外'})
                    </span>
                  )}
                </div>
                {skill.metrics.lastErrorPreview && (
                  <div className="text-[11px] rounded px-2 py-1 bg-red-50 text-red-700 border border-red-100">
                    直近エラー: {skill.metrics.lastErrorPreview}
                  </div>
                )}
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

      <div className="mt-4 rounded-xl overflow-hidden" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
        <div className="px-4 py-3 flex flex-col gap-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>スキル実行履歴</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {hasActiveFilters ? '絞り込み結果' : '最新'} {executionsData?.total ?? 0} 件
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              状態
              <select
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.status}
                onChange={(e) => updateFilter('status', e.target.value)}
              >
                <option value="">すべて</option>
                <option value="success">成功</option>
                <option value="error">エラー結果</option>
                <option value="exception">例外</option>
              </select>
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              リスク
              <select
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.riskLevel}
                onChange={(e) => updateFilter('riskLevel', e.target.value)}
              >
                <option value="">すべて</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              人物
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="personId"
                value={executionFilters.personQuery}
                onChange={(e) => updateFilter('personQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              チャネル
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="channelKey"
                value={executionFilters.channelQuery}
                onChange={(e) => updateFilter('channelQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              タスク
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="taskId"
                value={executionFilters.taskQuery}
                onChange={(e) => updateFilter('taskQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              開始日
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.from}
                onChange={(e) => updateFilter('from', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              終了日
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={executionFilters.to}
                onChange={(e) => updateFilter('to', e.target.value)}
              />
            </label>
          </div>
          {hasActiveFilters && (
            <button type="button" className="self-start text-xs underline" style={{ color: 'var(--text-secondary)' }} onClick={clearFilters}>
              絞り込みをクリア
            </button>
          )}
        </div>
        {!executionsData ? (
          <div className="h-20 animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
        ) : executionsData.executions.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: 'var(--text-secondary)' }}>実行履歴はまだありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                <tr>
                  {['時刻', 'スキル', '状態', 'リスク', '所要時間', '人物 / チャネル / タスク', '承認', '引数 / 結果'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {executionsData.executions.map((execution) => (
                  <tr key={execution.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(execution.finishedAt)}</td>
                    <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }}>{execution.skillName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.5 rounded ${execution.status === 'success' ? 'bg-green-100 text-green-700' : execution.status === 'error' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                        {execution.status === 'success' ? '成功' : execution.status === 'error' ? 'エラー結果' : '例外'}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {execution.riskLevel ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded ${RISK_STYLES[execution.riskLevel]?.bg ?? RISK_STYLES.low.bg} ${RISK_STYLES[execution.riskLevel]?.text ?? RISK_STYLES.low.text}`}>
                          {RISK_STYLES[execution.riskLevel]?.label ?? execution.riskLevel}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{execution.durationMs}ms</td>
                    <td className="px-3 py-2 font-mono max-w-[220px] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {[execution.personId, execution.channelKey, execution.taskId].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono max-w-[120px] truncate" style={{ color: 'var(--text-secondary)' }}>{execution.approvalId ?? '—'}</td>
                    <td className="px-3 py-2 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                      <div className="truncate">args: {execution.argsPreview || '—'}</div>
                      {(execution.resultPreview || execution.errorPreview) && (
                        <div className="truncate">{execution.errorPreview ? `error: ${execution.errorPreview}` : `result: ${execution.resultPreview}`}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Identities Panel
// ---------------------------------------------------------------------------

const TASK_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '実行中' },
  succeeded: { bg: 'bg-green-100', text: 'text-green-700', label: '成功' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '失敗' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-600', label: '取消' },
};


function taskMetadataPreview(metadata?: Record<string, unknown>): string {
  if (!metadata) return '—';
  const text = JSON.stringify(metadata);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

const DAG_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', label: '待機' },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '実行中' },
  succeeded: { bg: 'bg-green-100', text: 'text-green-700', label: '成功' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '失敗' },
  skipped: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'スキップ' },
};

function isAgentDag(value: unknown): value is DashboardAgentDag {
  if (!value || typeof value !== 'object') return false;
  const dag = value as Partial<DashboardAgentDag>;
  return typeof dag.runId === 'string' && Array.isArray(dag.plans) && Array.isArray(dag.progress);
}

function agentDagFromTask(task: DashboardTask): DashboardAgentDag | undefined {
  const value = task.metadata?.agentDag;
  return isAgentDag(value) ? value : undefined;
}

function computeLayers(plans: DashboardAgentDagPlan[]): DashboardAgentDagPlan[][] {
  const layers: DashboardAgentDagPlan[][] = [];
  const placed = new Set<string>();
  let remaining = [...plans];
  while (remaining.length > 0) {
    const layer = remaining.filter(p =>
      !p.dependsOn?.length || p.dependsOn.every(d => placed.has(d))
    );
    if (layer.length === 0) { layers.push(remaining); break; } // cycle fallback
    layers.push(layer);
    layer.forEach(p => placed.add(p.id));
    remaining = remaining.filter(p => !placed.has(p.id));
  }
  return layers;
}

function AgentDagMiniGraph({
  dag,
  taskId,
  retryingPlanId,
  onRetry,
  expanded,
}: {
  dag: DashboardAgentDag;
  taskId: string;
  retryingPlanId?: string;
  onRetry: (taskId: string, planId: string) => void;
  expanded?: boolean;
}) {
  const progressById = new Map(dag.progress.map((entry) => [entry.planId, entry]));
  const completed = dag.progress.filter((entry) => entry.status === 'succeeded').length;
  const failed = dag.progress.filter((entry) => entry.status === 'failed').length;
  const skipped = dag.progress.filter((entry) => entry.status === 'skipped').length;
  const total = dag.plans.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const layers = computeLayers(dag.plans);

  return (
    <div className="mt-2 rounded-lg p-2 space-y-2" style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>{dag.runId}</span>
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {completed}/{total} 完了
          {failed > 0 ? ` / 失敗 ${failed}` : ''}
          {skipped > 0 ? ` / skip ${skipped}` : ''}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${progressPct}%`, background: failed > 0 ? '#ef4444' : 'var(--accent-warm)' }}
        />
      </div>
      {/* Layered DAG nodes */}
      <div className="space-y-1">
        {layers.map((layer, layerIdx) => (
          <div key={layerIdx}>
            <div className={`flex flex-wrap gap-2 ${expanded ? '' : 'flex-nowrap overflow-x-auto'}`}>
              {layer.map((plan) => {
                const progress = progressById.get(plan.id);
                const st = DAG_STATUS_STYLES[progress?.status ?? 'pending'] ?? DAG_STATUS_STYLES.pending;
                const deps = plan.dependsOn?.length ? plan.dependsOn.join(', ') : null;
                const canRetry = progress?.status === 'failed' || progress?.status === 'skipped';
                const isRetrying = retryingPlanId === plan.id;
                return (
                  <div
                    key={plan.id}
                    className={`rounded-md p-2 ${expanded ? 'min-w-[180px] max-w-[260px]' : 'min-w-[160px] max-w-[220px]'}`}
                    style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)', flexShrink: 0 }}
                    title={progress?.error || plan.workspace || plan.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }}>{plan.id}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>{st.label}</span>
                    </div>
                    <div className="truncate mt-1" style={{ color: 'var(--text-secondary)' }}>{plan.role}</div>
                    {deps ? (
                      <div className="truncate font-mono mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        ← 依存: {deps}
                      </div>
                    ) : (
                      <div className="font-mono mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>root</div>
                    )}
                    {progress?.error ? <div className="truncate mt-1 text-red-600 text-[10px]">error: {progress.error}</div> : null}
                    {canRetry ? (
                      <button
                        type="button"
                        disabled={isRetrying || dag.status === 'running'}
                        onClick={() => onRetry(taskId, plan.id)}
                        className="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                        style={{ background: 'var(--accent-warm)', color: 'var(--text-primary)' }}
                      >
                        <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                        再実行
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {layerIdx < layers.length - 1 && (
              <div className="flex justify-center py-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>↓</div>
            )}
          </div>
        ))}
      </div>
      <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
        updated: {fmtDate(dag.updatedAt)}
      </div>
    </div>
  );
}

function TasksPanel({
  data,
  filters,
  onFiltersChange,
  onSkillExecutionFiltersChange,
  onTasksMutate,
}: {
  data: TasksData | undefined;
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  onSkillExecutionFiltersChange: (filters: SkillExecutionFilters) => void;
  onTasksMutate: () => void;
}) {
  const [retrying, setRetrying] = useState<Record<string, string>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const toggleExpanded = (taskId: string) => setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  const updateFilter = (key: keyof TaskFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };
  const clearFilters = () => onFiltersChange({ status: '', kindQuery: '', personQuery: '', channelQuery: '', from: '', to: '' });
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const showSkillExecutionsForTask = (task: DashboardTask) => {
    onSkillExecutionFiltersChange({
      status: '',
      riskLevel: '',
      personQuery: '',
      channelQuery: '',
      taskQuery: task.id,
      from: '',
      to: '',
    });
  };

  const retryAgentDagPlan = async (taskId: string, planId: string) => {
    setRetrying((current) => ({ ...current, [taskId]: planId }));
    try {
      const res = await dashboardFetch(`/api/dashboard/tasks/${taskId}/agent-dag/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        window.alert(data.error ?? 'Retry failed');
      }
      onTasksMutate();
    } finally {
      setRetrying((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  };

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Clock className="w-4 h-4" /> TaskLedger
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {hasActiveFilters ? '絞り込み結果' : '最新'} {data.total} 件
          </span>
        )}
      </h2>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
        <div className="px-4 py-3 flex flex-col gap-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              状態
              <select
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={filters.status}
                onChange={(e) => updateFilter('status', e.target.value)}
              >
                <option value="">すべて</option>
                <option value="running">実行中</option>
                <option value="succeeded">成功</option>
                <option value="failed">失敗</option>
                <option value="cancelled">取消</option>
              </select>
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              種別
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="conversation / schedule"
                value={filters.kindQuery}
                onChange={(e) => updateFilter('kindQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              人物
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="personId"
                value={filters.personQuery}
                onChange={(e) => updateFilter('personQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              チャネル
              <input
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="channelKey"
                value={filters.channelQuery}
                onChange={(e) => updateFilter('channelQuery', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              更新日 From
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={filters.from}
                onChange={(e) => updateFilter('from', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1" style={{ color: 'var(--text-secondary)' }}>
              更新日 To
              <input
                type="date"
                className="rounded px-2 py-1"
                style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                value={filters.to}
                onChange={(e) => updateFilter('to', e.target.value)}
              />
            </label>
          </div>
          {hasActiveFilters && (
            <button type="button" className="self-start text-xs underline" style={{ color: 'var(--text-secondary)' }} onClick={clearFilters}>
              絞り込みをクリア
            </button>
          )}
        </div>

        {!data ? (
          <div className="h-28 animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
        ) : data.tasks.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: 'var(--text-secondary)' }}>TaskLedger に一致するタスクはありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                <tr>
                  {['更新', '状態', '種別', 'タイトル / ID', '人物 / チャネル', '期間', 'メタデータ / エラー', '関連'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((task) => {
                  const st = TASK_STATUS_STYLES[task.status] ?? TASK_STATUS_STYLES.running;
                  const agentDag = agentDagFromTask(task);
                  const isExpanded = expandedTaskId === task.id;
                  const colCount = 8;
                  return (
                    <Fragment key={task.id}>
                      <tr
                        style={{ borderTop: '1px solid var(--border-color)', cursor: 'pointer' }}
                        onClick={() => toggleExpanded(task.id)}
                      >
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          <span className="mr-1" style={{ color: 'var(--text-secondary)' }}>{isExpanded ? '▾' : '▸'}</span>
                          {fmtDate(task.updatedAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className={`inline-block px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>{st.label}</span></td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{task.kind}</td>
                        <td className="px-3 py-2 max-w-[260px]">
                          <div className="truncate" style={{ color: 'var(--text-primary)' }} title={task.title || task.id}>{task.title || '—'}</div>
                          <div className="font-mono truncate" style={{ color: 'var(--text-secondary)' }} title={task.id}>{task.id}</div>
                        </td>
                        <td className="px-3 py-2 font-mono max-w-[220px]" style={{ color: 'var(--text-secondary)' }}>
                          <div className="truncate">{task.personId || '—'}</div>
                          <div className="truncate">{task.channelKey || '—'}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          <div>開始: {fmtDate(task.startedAt)}</div>
                          <div>終了: {task.finishedAt ? fmtDate(task.finishedAt) : '—'}</div>
                        </td>
                        <td className="px-3 py-2 max-w-[300px]" style={{ color: 'var(--text-secondary)' }}>
                          {task.errorPreview ? <div className="truncate text-red-600">error: {task.errorPreview}</div> : null}
                          {agentDag ? (
                            <AgentDagMiniGraph
                              dag={agentDag}
                              taskId={task.id}
                              retryingPlanId={retrying[task.id]}
                              onRetry={retryAgentDagPlan}
                            />
                          ) : (
                            <div className="font-mono truncate" title={taskMetadataPreview(task.metadata)}>{taskMetadataPreview(task.metadata)}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="text-xs underline" style={{ color: 'var(--text-primary)' }} onClick={() => showSkillExecutionsForTask(task)}>
                            スキル履歴へ
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td colSpan={colCount} className="px-4 py-4" style={{ background: 'var(--primary-bg)' }}>
                            <div className="space-y-3 text-xs">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>タスク ID</div>
                                  <div className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>{task.id}</div>
                                </div>
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>タイトル</div>
                                  <div className="break-words" style={{ color: 'var(--text-primary)' }}>{task.title || '—'}</div>
                                </div>
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>会話キー</div>
                                  <div className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>{task.conversationKey || '—'}</div>
                                </div>
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>タイムスタンプ</div>
                                  <div className="space-y-0.5 font-mono" style={{ color: 'var(--text-primary)' }}>
                                    <div>作成: {fmtDate(task.createdAt)}</div>
                                    <div>開始: {fmtDate(task.startedAt)}</div>
                                    <div>更新: {fmtDate(task.updatedAt)}</div>
                                    <div>終了: {task.finishedAt ? fmtDate(task.finishedAt) : '—'}</div>
                                  </div>
                                </div>
                              </div>
                              {task.errorPreview && (
                                <div>
                                  <div className="font-semibold mb-1 text-red-600">エラー</div>
                                  <pre className="whitespace-pre-wrap break-all rounded p-2 text-[11px] text-red-600" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>{task.errorPreview}</pre>
                                </div>
                              )}
                              {task.metadata && (
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>メタデータ (JSON)</div>
                                  <pre className="whitespace-pre-wrap break-all rounded p-2 text-[11px]" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>{JSON.stringify(task.metadata, null, 2)}</pre>
                                </div>
                              )}
                              {agentDag && (
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Agent DAG</div>
                                  <AgentDagMiniGraph
                                    dag={agentDag}
                                    taskId={task.id}
                                    retryingPlanId={retrying[task.id]}
                                    onRetry={retryAgentDagPlan}
                                    expanded={true}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function IdentitiesPanel({ data }: { data: IdentitiesData | undefined }) {
  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Activity className="w-4 h-4" /> 人物 / チャネル / タスク
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            人物 {data.total} 件
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-28 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.people.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          まだ人物 ID はありません。LINE / Discord / API から会話すると IdentityStore に追加されます。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.people.map((person) => (
            <div
              key={person.personId}
              className="rounded-xl p-4"
              style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}
            >
              <div className="flex flex-wrap items-start gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {person.displayName || person.personId}
                  </div>
                  <div className="font-mono text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {person.personId}
                  </div>
                </div>
                {person.runningTaskCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                    <Clock className="w-3 h-3" /> 実行中 {person.runningTaskCount}
                  </span>
                )}
              </div>

              <div className="mb-3">
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  チャネル ({person.channelCount})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {person.channelIdentities.map((identity) => (
                    <span
                      key={identity.channelKey}
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-mono"
                      style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                      title={identity.displayName ? `${identity.displayName} / ${identity.channelKey}` : identity.channelKey}
                    >
                      {identity.channelKey}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  最近のタスク ({person.taskCount})
                </div>
                {person.recentTasks.length === 0 ? (
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>タスク履歴はまだありません。</div>
                ) : (
                  <div className="space-y-1.5">
                    {person.recentTasks.map((task) => {
                      const st = TASK_STATUS_STYLES[task.status] ?? TASK_STATUS_STYLES.running;
                      return (
                        <div key={task.id} className="flex items-center gap-2 text-xs min-w-0">
                          <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>{st.label}</span>
                          <span className="font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>{task.kind}</span>
                          <span className="truncate" style={{ color: 'var(--text-primary)' }} title={task.title || task.id}>
                            {task.title || task.id}
                          </span>
                          <span className="shrink-0 ml-auto" style={{ color: 'var(--text-secondary)' }}>{fmtDate(task.updatedAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
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
    await dashboardFetch(`/api/dashboard/approvals/${id}/${action}`, { method: 'POST' });
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
// Section: Token Usage Panel
// ---------------------------------------------------------------------------

function TokenUsagePanel({ data }: { data: TokenUsageData | undefined }) {
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
// Section: Skill Proposals Panel
// ---------------------------------------------------------------------------

const PROPOSAL_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:              { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Draft' },
  testing:            { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Testing' },
  tests_failed:       { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Tests Failed' },
  awaiting_approval:  { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Awaiting Approval' },
  approved:           { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Approved' },
  rejected:           { bg: 'bg-red-100',    text: 'text-red-600',    label: 'Rejected' },
  registered:         { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Registered' },
};

const MAX_PROBLEM_LENGTH = 120;

function SkillProposalsPanel({
  data,
  statusFilter,
  onStatusFilterChange,
  onMutate,
}: {
  data: SkillProposalsData | undefined;
  statusFilter: SkillProposalStatusFilter;
  onStatusFilterChange: (s: SkillProposalStatusFilter) => void;
  onMutate: () => void;
}) {
  const [loading, setLoading] = useState<Record<string, string>>({});

  async function proposalAction(id: string, action: 'test' | 'approve' | 'reject') {
    setLoading((l) => ({ ...l, [id]: action }));
    await dashboardFetch(`/api/dashboard/skill-proposals/${id}/${action}`, { method: 'POST' });
    onMutate();
    setLoading((l) => { const n = { ...l }; delete n[id]; return n; });
  }

  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Zap className="w-4 h-4" /> Skill Proposals
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            {data.total} 件
          </span>
        )}
      </h2>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <label className="flex flex-col gap-1 text-xs w-48" style={{ color: 'var(--text-secondary)' }}>
            ステータスで絞り込み
            <select
              className="rounded px-2 py-1"
              style={{ background: 'var(--primary-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value as SkillProposalStatusFilter)}
            >
              <option value="">すべて</option>
              <option value="draft">Draft</option>
              <option value="testing">Testing</option>
              <option value="tests_failed">Tests Failed</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="registered">Registered</option>
            </select>
          </label>
        </div>

        {!data ? (
          <div className="h-24 animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
        ) : data.proposals.length === 0 ? (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            スキルプロポーザルはありません。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)' }}>
                <tr>
                  {['名前', 'ステータス', 'リスク', '課題 (抜粋)', 'テスト結果', '作成日時', '更新日時', '操作'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.proposals.map((p) => {
                  const st = PROPOSAL_STATUS_STYLES[p.status] ?? PROPOSAL_STATUS_STYLES.draft;
                  const risk = RISK_STYLES[p.riskLevel] ?? RISK_STYLES.low;
                  const passCount = p.testResults?.filter((r) => r.passed).length ?? 0;
                  const totalTests = p.testResults?.length ?? 0;
                  const problemText =
                    p.problem.length > MAX_PROBLEM_LENGTH
                      ? `${p.problem.slice(0, MAX_PROBLEM_LENGTH)}…`
                      : p.problem;
                  const isLoading = !!loading[p.id];
                  return (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {p.name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded ${risk.bg} ${risk.text}`}>
                          {risk.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[300px]" style={{ color: 'var(--text-secondary)' }}>
                        {problemText}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {p.testResults
                          ? (
                            <span className={passCount === totalTests && totalTests > 0 ? 'text-green-700' : 'text-red-600'}>
                              {passCount} / {totalTests} pass
                            </span>
                          )
                          : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(p.createdAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(p.updatedAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {(p.status === 'draft' || p.status === 'tests_failed') && (
                            <button
                              disabled={isLoading}
                              onClick={() => void proposalAction(p.id, 'test')}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-40 transition-colors"
                            >
                              {loading[p.id] === 'test' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                              Test
                            </button>
                          )}
                          {p.status === 'awaiting_approval' && (
                            <>
                              <button
                                disabled={isLoading}
                                onClick={() => void proposalAction(p.id, 'approve')}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-40 transition-colors"
                              >
                                {loading[p.id] === 'approve' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                Approve
                              </button>
                              <button
                                disabled={isLoading}
                                onClick={() => void proposalAction(p.id, 'reject')}
                                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40 transition-colors"
                              >
                                {loading[p.id] === 'reject' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

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

function SearchPanel() {
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

// ---------------------------------------------------------------------------
// ToolsetsPanel
// ---------------------------------------------------------------------------

function ToolsetsPanel({ data }: { data: ToolsetsData | undefined }) {
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

// ---------------------------------------------------------------------------
// ConversationsPanel
// ---------------------------------------------------------------------------

function ConversationsPanel({ data, onMutate }: { data: ConversationsData | undefined; onMutate: () => void }) {
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


type DashboardTab = 'overview' | 'operations' | 'observability' | 'governance' | 'tools';

const DASHBOARD_TABS: { id: DashboardTab; label: string; description: string }[] = [
  { id: 'overview', label: '概要', description: '状態・直近ログ' },
  { id: 'operations', label: '運用', description: 'スケジュール・タスク' },
  { id: 'observability', label: '観測', description: 'Telemetry・Token' },
  { id: 'governance', label: '承認', description: 'HITL・違反' },
  { id: 'tools', label: 'ツール', description: 'Skills・Toolsets' },
];

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--text-primary)' : 'rgba(255,255,255,0.52)',
    color: active ? 'var(--primary-bg)' : 'var(--text-primary)',
    border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border-color)'}`,
    boxShadow: active ? '0 10px 24px rgba(90,74,66,0.18)' : '0 1px 8px var(--shadow-light)',
  };
}

function DashboardTabs({ activeTab, onChange }: { activeTab: DashboardTab; onChange: (tab: DashboardTab) => void }) {
  return (
    <nav
      className="sticky top-0 z-20 -mx-4 mb-6 border-y px-4 py-3 backdrop-blur-xl md:top-3 md:mx-0 md:rounded-2xl md:border"
      style={{
        background: 'rgba(250,246,241,0.82)',
        borderColor: 'var(--border-color)',
        boxShadow: '0 8px 24px var(--shadow-light)',
      }}
      aria-label="Dashboard sections"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DASHBOARD_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className="rounded-xl px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
              style={tabButtonStyle(active)}
              aria-pressed={active}
            >
              <div className="text-sm font-bold">{tab.label}</div>
              <div className="mt-0.5 hidden text-[11px] opacity-75 lg:block">{tab.description}</div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [skillExecutionFilters, setSkillExecutionFilters] = useState<SkillExecutionFilters>({
    status: '',
    riskLevel: '',
    personQuery: '',
    channelQuery: '',
    taskQuery: '',
    from: '',
    to: '',
  });
  const [taskFilters, setTaskFilters] = useState<TaskFilters>({
    status: '',
    kindQuery: '',
    personQuery: '',
    channelQuery: '',
    from: '',
    to: '',
  });
  const [skillProposalStatusFilter, setSkillProposalStatusFilter] =
    useState<SkillProposalStatusFilter>('');
  const refreshInterval = autoRefresh ? 30_000 : 0;
  const showOverview = activeTab === 'overview';
  const showOperations = activeTab === 'operations';
  const showObservability = activeTab === 'observability';
  const showGovernance = activeTab === 'governance';
  const showTools = activeTab === 'tools';
  const skillProposalsUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (skillProposalStatusFilter) params.set('status', skillProposalStatusFilter);
    return `/api/dashboard/skill-proposals?${params.toString()}`;
  }, [skillProposalStatusFilter]);
  const skillExecutionsUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    Object.entries(skillExecutionFilters).forEach(([key, value]) => {
      if (!value) return;
      params.set(key, key === 'to' ? `${value}T23:59:59` : value);
    });
    return `/api/dashboard/skill-executions?${params.toString()}`;
  }, [skillExecutionFilters]);
  const tasksUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    Object.entries(taskFilters).forEach(([key, value]) => {
      if (!value) return;
      params.set(key, key === 'to' ? `${value}T23:59:59` : value);
    });
    return `/api/dashboard/tasks?${params.toString()}`;
  }, [taskFilters]);

  const { data: statusData, mutate: mutateStatus } =
    useSWR<StatusData>('/api/dashboard/status', fetcher, { refreshInterval });
  const { data: schedulesData, mutate: mutateSchedules } =
    useSWR<SchedulesData>(showOperations ? '/api/dashboard/schedules' : null, fetcher, { refreshInterval });
  const { data: watchersData, mutate: mutateWatchers } =
    useSWR<WatchersData>(showOperations ? '/api/dashboard/watchers' : null, fetcher, { refreshInterval });
  const { data: logsData, mutate: mutateLogs } =
    useSWR<LogsData>(showOverview ? '/api/dashboard/logs?limit=20' : null, fetcher, { refreshInterval });
  const { data: skillsData } =
    useSWR<SkillsData>(showTools ? '/api/dashboard/skills' : null, fetcher);
  const { data: skillExecutionsData, mutate: mutateSkillExecutions } =
    useSWR<SkillExecutionsData>(showTools ? skillExecutionsUrl : null, fetcher, { refreshInterval });
  const { data: approvalsData, mutate: mutateApprovals } =
    useSWR<ApprovalsData>(showGovernance ? '/api/dashboard/approvals' : null, fetcher, { refreshInterval: 3_000 });
  const { data: identitiesData, mutate: mutateIdentities } =
    useSWR<IdentitiesData>(showOperations ? '/api/dashboard/identities?limit=50&recentTaskLimit=3' : null, fetcher, { refreshInterval });
  const { data: tasksData, mutate: mutateTasks } =
    useSWR<TasksData>(showOperations ? tasksUrl : null, fetcher, { refreshInterval });
  const { data: telemetryData } =
    useSWR<TelemetryData>(showObservability ? '/api/dashboard/telemetry?limit=50' : null, fetcher, { refreshInterval });
  const { data: violationsData } =
    useSWR<ViolationsData>(showGovernance ? '/api/dashboard/violations?limit=50' : null, fetcher, { refreshInterval });
  const { data: skillProposalsData, mutate: mutateSkillProposals } =
    useSWR<SkillProposalsData>(showGovernance ? skillProposalsUrl : null, fetcher, { refreshInterval });
  const { data: toolsetsData } =
    useSWR<ToolsetsData>(showTools ? '/api/dashboard/toolsets' : null, fetcher);
  const { data: tokenUsageData } =
    useSWR<TokenUsageData>(showObservability ? '/api/dashboard/token-usage' : null, fetcher, { refreshInterval });
  const { data: conversationsData, mutate: mutateConversations } =
    useSWR<ConversationsData>(showOperations ? '/api/dashboard/conversations?limit=100' : null, fetcher, { refreshInterval });

  function refreshAll() {
    void mutateStatus();
    void mutateSchedules();
    void mutateWatchers();
    void mutateLogs();
    void mutateApprovals();
    void mutateIdentities();
    void mutateTasks();
    void mutateSkillExecutions();
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
        <DashboardTabs activeTab={activeTab} onChange={setActiveTab} />

        {showOverview && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <StatusCards data={statusData} />
              <SearchPanel />
            </div>
            <LogFeed data={logsData} />
          </div>
        )}

        {showOperations && (
          <>
            <SchedulerPanel data={schedulesData} onMutate={() => { void mutateSchedules(); void mutateLogs(); }} />
            <WatchersPanel data={watchersData} onMutate={() => { void mutateWatchers(); void mutateLogs(); void mutateTasks(); }} />
            <TasksPanel
              data={tasksData}
              filters={taskFilters}
              onFiltersChange={setTaskFilters}
              onSkillExecutionFiltersChange={setSkillExecutionFilters}
              onTasksMutate={() => void mutateTasks()}
            />
            <IdentitiesPanel data={identitiesData} />
            <ConversationsPanel data={conversationsData} onMutate={() => void mutateConversations()} />
          </>
        )}

        {showObservability && (
          <>
            <TelemetryPanel data={telemetryData} />
            <TokenUsagePanel data={tokenUsageData} />
          </>
        )}

        {showGovernance && (
          <>
            <ApprovalsPanel data={approvalsData} onMutate={() => void mutateApprovals()} />
            <SkillProposalsPanel
              data={skillProposalsData}
              statusFilter={skillProposalStatusFilter}
              onStatusFilterChange={setSkillProposalStatusFilter}
              onMutate={() => void mutateSkillProposals()}
            />
            <ViolationsPanel data={violationsData} />
          </>
        )}

        {showTools && (
          <>
            <ToolsetsPanel data={toolsetsData} />
            <SkillsPanel
              data={skillsData}
              executionsData={skillExecutionsData}
              executionFilters={skillExecutionFilters}
              onExecutionFiltersChange={setSkillExecutionFilters}
            />
          </>
        )}
      </div>
    </div>
  );
}
