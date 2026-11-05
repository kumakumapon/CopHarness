import type { Message, StopReason, ToolCallPart, ToolResultPart, ToolSpec, Usage } from '../types';

export interface ModelRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string };

export interface ModelResult {
  message: Message;
  stopReason: StopReason;
  usage: Usage;
}

/** One model call: send the conversation, stream deltas, return the assistant message. */
export interface ModelProvider {
  /** Provider key used for native replay ("anthropic", "openai", "gemini", "copilot"). */
  readonly kind: string;
  stream(request: ModelRequest, onEvent: (event: ModelEvent) => void): Promise<ModelResult>;
  /**
   * Providers whose SDK runs the tool loop itself (GitHub Copilot) implement
   * this instead of being driven step by step. Tool calls still go through
   * `executeTool`, so permissions and hooks apply unchanged.
   */
  runTurn?(request: ModelRequest & {
    onEvent: (event: ModelEvent) => void;
    executeTool: (call: ToolCallPart) => Promise<ToolResultPart>;
  }): Promise<{ text: string; usage: Usage; stopReason: StopReason }>;
}

/** Errors worth retrying before any output has been streamed. */
export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string; name?: string; message?: string; error?: { type?: string } };
  if (e.name === 'AbortError') return false;
  if (typeof e.status === 'number') return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  if (e.error?.type === 'overloaded_error') return true;
  if (e.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(e.code)) return true;
  return /overloaded|rate limit|temporarily unavailable|socket hang up/i.test(e.message ?? '');
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true });
});

/** Retry a provider call on transient failures, but never after output reached the user. */
export function withRetry(provider: ModelProvider, attempts = 3): ModelProvider {
  return {
    kind: provider.kind,
    runTurn: provider.runTurn?.bind(provider),
    async stream(request, onEvent) {
      for (let attempt = 1; ; attempt++) {
        let emitted = false;
        try {
          return await provider.stream(request, e => { emitted = true; onEvent(e); });
        } catch (err) {
          if (emitted || attempt >= attempts || request.signal?.aborted || !isTransientError(err)) throw err;
          await sleep(1000 * 2 ** (attempt - 1), request.signal);
        }
      }
    },
  };
}
