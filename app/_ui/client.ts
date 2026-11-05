/** Browser-side API client. The access token lives in localStorage. */
import type { AgentEvent } from '../../lib/types';

const TOKEN_KEY = 'copharness.token';

export function readToken(): string {
  if (typeof window === 'undefined') return '';
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const fromHash = hash.get('token');
  if (fromHash) {
    try { localStorage.setItem(TOKEN_KEY, fromHash); } catch { /* private mode */ }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return fromHash;
  }
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function saveToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
}

export class Unauthorized extends Error {}

export async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) throw new Unauthorized('Unauthorized');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** POST (or GET) and read the server-sent event stream. Resolves when the stream ends. */
export async function stream(
  token: string,
  path: string,
  body: unknown | undefined,
  onEvent: (event: AgentEvent | { type: 'idle' }) => void,
  onSessionId?: (id: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (res.status === 401) throw new Unauthorized('Unauthorized');
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const id = res.headers.get('x-session-id');
  if (id) onSessionId?.(id);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try { onEvent(JSON.parse(data)); } catch { /* ignore malformed */ }
      }
    }
  }
}

export function fileToImage(file: File): Promise<{ type: 'image'; mimeType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ type: 'image', mimeType: file.type, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}
