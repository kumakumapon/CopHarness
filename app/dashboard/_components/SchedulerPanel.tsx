'use client';

import { useState } from 'react';
import {
  RefreshCw,
  Play,
  Square,
  ToggleLeft,
  ToggleRight,
  Clock,
  Plus,
  Trash2,
  Pencil,
  X,
} from 'lucide-react';
import type { Schedule, SchedulesData } from './types';
import { dashboardFetch } from './api';
import { fmtDate } from './shared';


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

export function SchedulerPanel({ data, onMutate }: { data: SchedulesData | undefined; onMutate: () => void }) {
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
