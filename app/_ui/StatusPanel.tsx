'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Play, Trash2, X } from 'lucide-react';
import { api } from './client';

interface Check { level: 'ok' | 'warn' | 'error'; label: string; detail?: string }
export interface Status {
  model: string;
  modelConfigured: boolean;
  providers: Array<{ name: string; configured: boolean }>;
  workspace: string;
  dataDir: string;
  permissionMode: string;
  permissionModes: string[];
  tools: Array<{ name: string; access: string; description: string }>;
  mcp: Array<{ name: string; state: string; error?: string; tools: string[] }>;
  skills: Array<{ name: string; description: string }>;
  usageToday: { usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }; costUsd: number };
  limits: { dailyCostUsd?: number; dailyTokens?: number };
  checks: Check[];
}

interface Schedule {
  id: string; name: string; cron: string; prompt: string; enabled: boolean; nextRunAt?: string; running?: boolean;
  lastStatus?: string; lastRunAt?: string; lastError?: string; lastSessionId?: string;
  deliver?: { channel: string; to: string };
}

const ACCESS_LABEL: Record<string, string> = { read: '読み取り', state: '内部状態', edit: '編集', execute: '実行' };
const ACCESS_STYLE: Record<string, string> = {
  read: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  state: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  edit: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  execute: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

function Schedules({ token, onOpenSession }: { token: string; onOpenSession(id: string): void }) {
  const [list, setList] = useState<Schedule[]>([]);
  const [form, setForm] = useState({ name: '', cron: '0 9 * * *', prompt: '', channel: '', to: '' });
  const [error, setError] = useState('');
  const load = useCallback(() => api<{ schedules: Schedule[] }>(token, '/api/schedules').then(r => setList(r.schedules)).catch(e => setError(String(e.message))), [token]);
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const add = () => act(() => api(token, '/api/schedules', {
    method: 'POST',
    body: JSON.stringify({ name: form.name, cron: form.cron, prompt: form.prompt, deliver: form.channel && form.to ? { channel: form.channel, to: form.to } : undefined }),
  }).then(() => setForm({ ...form, name: '', prompt: '' })));

  return (
    <div>
      {list.length === 0 && <p className="mb-3 text-sm text-zinc-500">スケジュールはありません。</p>}
      {list.map(s => (
        <div key={s.id} className="mb-2 rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={s.enabled} onChange={e => act(() => api(token, `/api/schedules/${s.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: e.target.checked }) }))} />
            <span className="flex-1 truncate font-medium">{s.name}</span>
            <code className="text-[11px] text-zinc-500">{s.cron}</code>
            <button title="今すぐ実行" disabled={s.running} onClick={() => act(() => api(token, `/api/schedules/${s.id}/run`, { method: 'POST' }))} className="rounded p-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"><Play className="h-3.5 w-3.5" /></button>
            <button title="削除" onClick={() => confirm(`「${s.name}」を削除しますか？`) && act(() => api(token, `/api/schedules/${s.id}`, { method: 'DELETE' }))} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          <div className="mt-1 truncate text-xs text-zinc-500">{s.prompt}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
            {s.running && <span className="text-orange-600">実行中…</span>}
            {s.nextRunAt && <span>次回 {new Date(s.nextRunAt).toLocaleString('ja-JP')}</span>}
            {s.deliver && <span>→ {s.deliver.channel}</span>}
            {s.lastStatus && <button className="underline" onClick={() => s.lastSessionId && onOpenSession(s.lastSessionId)}>前回: {s.lastStatus}</button>}
            {s.lastError && <span className="text-red-600">{s.lastError}</span>}
          </div>
        </div>
      ))}
      <div className="mt-3 space-y-2 rounded-lg bg-zinc-50 p-2 text-sm dark:bg-zinc-800/60">
        <div className="flex gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="名前" className="w-1/2 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900" />
          <input value={form.cron} onChange={e => setForm({ ...form, cron: e.target.value })} placeholder="0 9 * * * / 09:00" className="w-1/2 rounded border border-zinc-300 bg-white px-2 py-1 font-mono dark:border-zinc-600 dark:bg-zinc-900" />
        </div>
        <textarea value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="実行するプロンプト" rows={2} className="w-full rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900" />
        <div className="flex gap-2">
          <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900">
            <option value="">配信しない</option>
            <option value="discord">Discord</option>
            <option value="line">LINE</option>
            <option value="slack">Slack</option>
            <option value="webhook">Webhook</option>
          </select>
          {form.channel && <input value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} placeholder={form.channel === 'webhook' ? 'URL' : 'チャンネル / ユーザー ID'} className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900" />}
        </div>
        <button onClick={add} disabled={!form.prompt.trim()} className="w-full rounded bg-zinc-900 py-1.5 text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900">スケジュールを追加</button>
        <p className="text-[11px] text-zinc-500">cron はサーバーのローカル時刻です。実行中に承認が必要になったツールは、この画面から承認できます。</p>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function StatusPanel({ token, onClose, onOpenSession }: { token: string; onClose(): void; onOpenSession(id: string): void }) {
  const [tab, setTab] = useState<'status' | 'tools' | 'schedules'>('status');
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  useEffect(() => { api<Status>(token, '/api/status').then(setStatus).catch(e => setError(String(e.message))); }, [token]);
  const u = status?.usageToday;
  const tokens = u ? u.usage.inputTokens + u.usage.outputTokens + u.usage.cacheReadTokens + u.usage.cacheWriteTokens : 0;

  return (
    <aside className="flex h-full w-full max-w-md shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {(['status', 'tools', 'schedules'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-zinc-100 font-medium dark:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}>
            {t === 'status' ? '状態' : t === 'tools' ? 'ツール' : <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />スケジュール</span>}
          </button>
        ))}
        <button onClick={onClose} aria-label="閉じる" className="ml-auto rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!status && !error && <p className="text-sm text-zinc-500">読み込み中…</p>}
        {status && tab === 'status' && (
          <>
            <Section title="本日の使用量">
              <div className="text-2xl font-semibold">${u!.costUsd.toFixed(4)}</div>
              <div className="text-xs text-zinc-500">{tokens.toLocaleString()} tokens
                {status.limits.dailyCostUsd !== undefined && ` · 上限 $${status.limits.dailyCostUsd}`}
                {status.limits.dailyTokens !== undefined && ` · 上限 ${status.limits.dailyTokens.toLocaleString()} tokens`}
              </div>
            </Section>
            <Section title="診断">
              <ul className="space-y-1.5 text-sm">
                {status.checks.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={c.level === 'ok' ? 'text-emerald-600' : c.level === 'warn' ? 'text-amber-600' : 'text-red-600'}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span>
                    <span><span className="font-medium">{c.label}</span>{c.detail && <span className="block break-all text-xs text-zinc-500">{c.detail}</span>}</span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="プロバイダ">
              <div className="flex flex-wrap gap-1.5 text-xs">
                {status.providers.map(p => <span key={p.name} className={`rounded px-1.5 py-0.5 ${p.configured ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>{p.name}</span>)}
              </div>
            </Section>
          </>
        )}
        {status && tab === 'tools' && (
          <>
            <Section title={`ツール（${status.tools.length}）`}>
              <ul className="space-y-1.5 text-sm">
                {status.tools.map(t => (
                  <li key={t.name}>
                    <div className="flex items-center gap-2"><span className="font-mono text-[13px]">{t.name}</span><span className={`rounded px-1 text-[10px] ${ACCESS_STYLE[t.access]}`}>{ACCESS_LABEL[t.access]}</span></div>
                    <div className="text-xs text-zinc-500">{t.description}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-zinc-500">default モードでは「編集」「実行」のツールは実行前に確認します。</p>
            </Section>
            <Section title="MCP サーバー">
              {status.mcp.length === 0 ? <p className="text-sm text-zinc-500">未設定（copharness.json の mcpServers）</p> : status.mcp.map(m => (
                <div key={m.name} className="text-sm"><span className="font-medium">{m.name}</span> <span className={m.state === 'connected' ? 'text-emerald-600' : 'text-red-600'}>{m.state}</span> <span className="text-xs text-zinc-500">{m.error ?? `${m.tools.length} ツール`}</span></div>
              ))}
            </Section>
            <Section title="スキル">
              {status.skills.length === 0 ? <p className="text-sm text-zinc-500">なし（skills/&lt;名前&gt;/SKILL.md を置くと使えます）</p> : status.skills.map(s => (
                <div key={s.name} className="mb-1 text-sm"><span className="font-medium">{s.name}</span><div className="text-xs text-zinc-500">{s.description}</div></div>
              ))}
            </Section>
          </>
        )}
        {tab === 'schedules' && <Schedules token={token} onOpenSession={onOpenSession} />}
      </div>
    </aside>
  );
}
