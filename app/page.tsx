'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, ImagePlus, Menu, Settings2, ShieldAlert, Square, X } from 'lucide-react';
import type { SessionDetail } from '../lib/runtime';
import type { AgentEvent, ImagePart, PermissionDecision, PermissionRequest, TodoItem } from '../lib/types';
import { api, fileToImage, readToken, saveToken, stream, Unauthorized } from './_ui/client';
import { Empty, Sidebar, Timeline, Todos, type SessionSummary } from './_ui/components';
import { StatusPanel, type Status } from './_ui/StatusPanel';
import { applyEvent, itemsFromTranscript, type Item } from './_ui/timeline';

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  openai: ['gpt-5', 'gpt-5-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  copilot: ['gpt-5-mini'],
};
const MODE_LABELS: Record<string, string> = { default: '確認あり', acceptEdits: '編集は自動', readonly: '読み取りのみ', bypass: '全て自動' };

function Login({ onSubmit, error }: { onSubmit(token: string): void; error?: string }) {
  const [value, setValue] = useState('');
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={e => { e.preventDefault(); onSubmit(value.trim()); }} className="w-full max-w-sm rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <div className="mb-4 flex items-center gap-2"><Bot className="h-5 w-5 text-orange-500" /><span className="font-semibold">CopHarness</span></div>
        <label className="text-sm font-medium">アクセストークン</label>
        <input autoFocus type="password" value={value} onChange={e => setValue(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        <p className="mt-2 text-xs text-zinc-500">サーバー起動時に表示される URL を開くか、<code>npm run cli -- token</code> で表示されるトークンを入力してください（COPHARNESS_API_KEY を設定している場合はその値）。</p>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button className="mt-4 w-full rounded-lg bg-zinc-900 py-2 text-white dark:bg-white dark:text-zinc-900">ログイン</button>
      </form>
    </main>
  );
}

export default function Home() {
  const [token, setToken] = useState<string>();
  const [unauthorized, setUnauthorized] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [detail, setDetail] = useState<SessionDetail>();
  const [items, setItems] = useState<Item[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  /** A message typed while a turn was running; sent when the turn ends. */
  const [queued, setQueued] = useState<string>();
  const [images, setImages] = useState<ImagePart[]>([]);
  const [newModel, setNewModel] = useState('');
  const [newMode, setNewMode] = useState('');
  const [approvals, setApprovals] = useState<PermissionRequest[]>([]);
  const [panel, setPanel] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const streamAbort = useRef<AbortController | undefined>(undefined);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const currentRef = useRef<string | undefined>(undefined);
  currentRef.current = currentId;
  /** Incremented per send/attach so a finishing stream never clears a newer run's state. */
  const runSeq = useRef(0);

  useEffect(() => { setToken(readToken()); setSidebar(window.innerWidth >= 768); }, []);

  const handle = useCallback((err: unknown) => {
    if (err instanceof Unauthorized) setUnauthorized(true);
    else if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : String(err));
  }, []);

  const loadSessions = useCallback(async () => {
    if (!token) return;
    try { setSessions((await api<{ sessions: SessionSummary[] }>(token, '/api/sessions')).sessions); } catch (e) { handle(e); }
  }, [token, handle]);

  useEffect(() => {
    if (!token) return;
    api<Status>(token, '/api/status').then(s => { setStatus(s); setUnauthorized(false); }).catch(handle);
    void loadSessions();
    const t = setInterval(loadSessions, 10_000);
    return () => clearInterval(t);
  }, [token, loadSessions, handle]);

  // Approvals can come from any session (chat bots, schedules, other tabs).
  useEffect(() => {
    if (!token || unauthorized) return;
    const poll = () => api<{ approvals: PermissionRequest[] }>(token, '/api/approvals').then(r => {
      setApprovals(r.approvals);
      const mine = r.approvals.filter(a => a.sessionId === currentRef.current);
      if (mine.length) setItems(prev => mine.reduce((acc, request) => applyEvent(acc, { type: 'permission_request', request }), prev));
    }).catch(() => undefined);
    void poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [token, unauthorized]);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  }, [items]);

  const onEvent = useCallback((e: AgentEvent | { type: 'idle' }) => {
    if (e.type === 'idle') return;
    if (e.type === 'todos') setTodos(e.todos);
    if (e.type === 'turn_end') setRunning(false);
    setItems(prev => applyEvent(prev, e));
  }, []);

  const refreshDetail = useCallback(async (id: string, rebuild: boolean) => {
    if (!token) return;
    const d = await api<SessionDetail>(token, `/api/sessions/${id}`);
    if (currentRef.current !== id) return;
    setDetail(d);
    setTodos(d.todos);
    if (rebuild) setItems(itemsFromTranscript(d.messages));
    return d;
  }, [token]);

  const attach = useCallback(async (id: string) => {
    if (!token) return;
    streamAbort.current?.abort();
    const ctrl = new AbortController();
    streamAbort.current = ctrl;
    const seq = ++runSeq.current;
    setRunning(true);
    try {
      await stream(token, `/api/sessions/${id}/events?replay=0`, undefined, onEvent, undefined, ctrl.signal);
    } catch (e) { handle(e); } finally {
      if (runSeq.current === seq && currentRef.current === id) { setRunning(false); await refreshDetail(id, true).catch(handle); }
    }
  }, [token, onEvent, handle, refreshDetail]);

  const open = useCallback(async (id: string) => {
    streamAbort.current?.abort();
    runSeq.current++;
    setCurrentId(id);
    currentRef.current = id;
    setError('');
    setRunning(false);
    if (window.innerWidth < 768) setSidebar(false);
    try {
      const d = await refreshDetail(id, true);
      if (d?.running) void attach(id);
    } catch (e) { handle(e); }
  }, [refreshDetail, attach, handle]);

  const newChat = () => {
    streamAbort.current?.abort();
    runSeq.current++;
    setCurrentId(undefined);
    currentRef.current = undefined;
    setDetail(undefined);
    setItems([]);
    setTodos([]);
    setRunning(false);
    setError('');
    textarea.current?.focus();
  };

  const send = async (queuedText?: string) => {
    const text = queuedText ?? input.trim();
    if (!text || !token) return;
    if (running) {
      setQueued(text);
      setInput('');
      return;
    }
    if (queuedText === undefined) setInput('');
    const sentImages = images;
    setImages([]);
    setError('');
    setItems(prev => [...prev, { kind: 'user', key: `u-${Date.now()}`, text, images: sentImages }]);
    setRunning(true);
    const ctrl = new AbortController();
    streamAbort.current = ctrl;
    const seq = ++runSeq.current;
    let id = currentId;
    try {
      const path = id ? `/api/sessions/${id}/messages` : '/api/sessions';
      const body = id ? { message: text, images: sentImages } : { message: text, images: sentImages, model: newModel || undefined, mode: newMode || undefined };
      await stream(token, path, body, onEvent, newId => {
        id = newId;
        setCurrentId(newId);
        currentRef.current = newId;
        void loadSessions();
      }, ctrl.signal);
    } catch (e) { handle(e); } finally {
      if (runSeq.current === seq && currentRef.current === id) setRunning(false);
      void loadSessions();
      if (id && currentRef.current === id) void refreshDetail(id, false).catch(() => undefined);
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!running && queued) {
      setQueued(undefined);
      void sendRef.current(queued);
    }
  }, [running, queued]);

  const stop = () => { if (currentId && token) void api(token, `/api/sessions/${currentId}/cancel`, { method: 'POST' }).catch(handle); };

  const decide = (id: string, decision: PermissionDecision) => {
    if (!token) return;
    setItems(prev => applyEvent(prev, { type: 'permission_resolved', id, decision }));
    setApprovals(prev => prev.filter(a => a.id !== id));
    void api(token, `/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }).catch(handle);
  };

  const patchSession = async (patch: { model?: string; mode?: string }) => {
    if (!token) return;
    if (!currentId) {
      if (patch.model !== undefined) setNewModel(patch.model);
      if (patch.mode !== undefined) setNewMode(patch.mode);
      return;
    }
    try { setDetail(await api<SessionDetail>(token, `/api/sessions/${currentId}`, { method: 'PATCH', body: JSON.stringify(patch) })); } catch (e) { handle(e); }
  };

  const remove = async (id: string) => {
    if (!token || !confirm('この会話を削除しますか？')) return;
    try {
      await api(token, `/api/sessions/${id}`, { method: 'DELETE' });
      if (id === currentId) newChat();
      void loadSessions();
    } catch (e) { handle(e); }
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter(f => /^image\/(png|jpeg|gif|webp)$/.test(f.type)).slice(0, 4);
    const converted = await Promise.all(list.map(fileToImage));
    setImages(prev => [...prev, ...converted].slice(0, 4));
  };

  if (token === undefined) return null;
  if (unauthorized || !token) {
    return <Login error={unauthorized && token ? 'トークンが正しくありません。' : undefined} onSubmit={t => { saveToken(t); setUnauthorized(false); setToken(t); }} />;
  }

  const model = detail?.model ?? (newModel || status?.model || '');
  const mode = detail?.permissionMode ?? (newMode || status?.permissionMode || 'default');
  const configured = new Set(status?.providers.filter(p => p.configured).map(p => p.name) ?? []);
  const suggestions = Object.entries(MODEL_SUGGESTIONS).filter(([p]) => configured.has(p)).flatMap(([p, ms]) => ms.map(m => `${p}/${m}`));
  const otherApprovals = approvals.filter(a => a.sessionId !== currentId);
  const waiting = new Set(approvals.map(a => a.sessionId));

  return (
    <div className="flex h-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {sidebar && <Sidebar sessions={sessions} currentId={currentId} waiting={waiting} onSelect={open} onNew={newChat} onDelete={remove} />}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <button aria-label="メニュー" onClick={() => setSidebar(!sidebar)} className="rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Menu className="h-4 w-4" /></button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{detail?.title ?? '新しい会話'}</div>
          {otherApprovals.length > 0 && (
            <button onClick={() => open(otherApprovals[0].sessionId)} className="flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
              <ShieldAlert className="h-3.5 w-3.5" /> 承認待ち {otherApprovals.length}
            </button>
          )}
          <input list="models" value={model} onChange={e => (currentId ? setDetail(d => (d ? { ...d, model: e.target.value } : d)) : setNewModel(e.target.value))} onBlur={e => { if (currentId && e.target.value.trim()) void patchSession({ model: e.target.value.trim() }); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} title="モデル（provider/model）" className="hidden w-56 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 font-mono text-xs sm:block dark:border-zinc-700" />
          <datalist id="models">{suggestions.map(s => <option key={s} value={s} />)}</datalist>
          <select value={mode} onChange={e => void patchSession({ mode: e.target.value })} title="権限モード" className="rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700">
            {(status?.permissionModes ?? ['default', 'acceptEdits', 'readonly', 'bypass']).map(m => <option key={m} value={m}>{MODE_LABELS[m] ?? m}</option>)}
          </select>
          <button aria-label="状態と設定" onClick={() => setPanel(!panel)} className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${status && !status.modelConfigured ? 'text-red-600' : ''}`}><Settings2 className="h-4 w-4" /></button>
        </header>

        <div ref={scroller} className="flex-1 overflow-y-auto px-4">
          <div className="mx-auto max-w-3xl py-6">
            {status && !status.modelConfigured && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                モデル {status.model} の認証情報が設定されていません。右上の設定から診断結果を確認してください。
              </div>
            )}
            {items.length === 0 && !currentId ? <Empty onPick={p => { setInput(p); textarea.current?.focus(); }} /> : <Timeline items={items} onDecide={decide} />}
            {running && !['assistant', 'approval'].includes(items[items.length - 1]?.kind ?? '') && <div className="py-2 text-[13px] text-zinc-400">考えています…</div>}
            {error && <div className="my-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</div>}
          </div>
        </div>

        <div className="px-4 pb-4">
          <Todos todos={todos} />
          {queued && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-[13px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              <span className="shrink-0 text-zinc-500">完了後に送信:</span>
              <span className="min-w-0 flex-1 truncate">{queued}</span>
              <button aria-label="送信待ちを取り消す" onClick={() => { setInput(queued); setQueued(undefined); }} className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-300 bg-white shadow-sm focus-within:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
            {images.length > 0 && (
              <div className="flex gap-2 px-3 pt-3">
                {images.map((img, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:${img.mimeType};base64,${img.data}`} alt="" className="h-16 w-16 rounded-md object-cover" />
                    <button aria-label="画像を外す" onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-800 p-0.5 text-white"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textarea}
              value={input}
              rows={1}
              onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`; }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
              }}
              onPaste={e => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); void addFiles(files); } }}
              placeholder="メッセージを入力…"
              className="block max-h-60 w-full resize-none bg-transparent px-4 py-3 outline-none"
            />
            <div className="flex items-center gap-2 px-3 pb-2">
              <label className="cursor-pointer rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="画像を添付">
                <ImagePlus className="h-4 w-4" />
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={e => e.target.files && void addFiles(e.target.files)} />
              </label>
              <span className="flex-1 truncate text-[11px] text-zinc-400">
                {detail ? `$${detail.costUsd.toFixed(4)} · ` : ''}{MODE_LABELS[mode] ?? mode}
                <span className="hidden sm:inline"> · Enter で送信 / Shift+Enter で改行</span>
              </span>
              {running ? (
                <button onClick={stop} aria-label="停止" className="rounded-full bg-zinc-900 p-2 text-white dark:bg-white dark:text-zinc-900"><Square className="h-3.5 w-3.5" /></button>
              ) : (
                <button onClick={() => void send()} disabled={!input.trim()} aria-label="送信" className="rounded-full bg-zinc-900 p-2 text-white disabled:opacity-30 dark:bg-white dark:text-zinc-900"><ArrowUp className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
        </div>
      </main>
      {panel && <StatusPanel token={token} onClose={() => setPanel(false)} onOpenSession={id => { void open(id); }} />}
    </div>
  );
}
