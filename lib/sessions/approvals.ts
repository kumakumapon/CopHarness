/**
 * Pending tool approvals. Any interface can answer a request: the CLI prompt,
 * the web UI, the HTTP API or an approver in a chat channel. Requests that are
 * not answered in time, or whose run is cancelled, are denied.
 */
import type { PermissionDecision, PermissionRequest } from '../types';

interface Pending {
  request: PermissionRequest;
  resolve(decision: PermissionDecision, by?: string): void;
}

type Listener = (event: { type: 'requested'; request: PermissionRequest } | { type: 'resolved'; id: string; decision: PermissionDecision; by?: string }) => void;

export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<Listener>();

  request(request: PermissionRequest, options: { timeoutMs: number; signal?: AbortSignal }): Promise<{ decision: PermissionDecision; by?: string }> {
    return new Promise(resolve => {
      let settled = false;
      const settle = (decision: PermissionDecision, by?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        this.pending.delete(request.id);
        this.notify({ type: 'resolved', id: request.id, decision, by });
        resolve({ decision, by });
      };
      const timer = setTimeout(() => settle('deny', 'timeout'), options.timeoutMs);
      const onAbort = () => settle('deny', 'cancelled');
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(request.id, { request, resolve: settle });
      this.notify({ type: 'requested', request });
      if (options.signal?.aborted) onAbort();
    });
  }

  resolve(id: string, decision: PermissionDecision, by?: string): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    p.resolve(decision, by);
    return true;
  }

  get(id: string): PermissionRequest | undefined {
    return this.pending.get(id)?.request;
  }

  list(sessionId?: string): PermissionRequest[] {
    return [...this.pending.values()].map(p => p.request).filter(r => !sessionId || r.sessionId === sessionId);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event: Parameters<Listener>[0]) {
    for (const l of this.listeners) {
      try { l(event); } catch { /* listener errors never break approvals */ }
    }
  }
}
