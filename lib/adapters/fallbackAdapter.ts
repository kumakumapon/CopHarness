import type { LLMAdapter, LLMRequest, LLMResponse } from '../adapter';

/**
 * Wraps multiple LLM adapters and tries them in order.
 *
 * When the primary adapter fails with a non-auth error (e.g. timeout,
 * rate limit, server error), the request is retried with the next adapter.
 * Authentication errors (401/403) are never retried since they indicate
 * a configuration problem rather than a transient failure.
 *
 * Configure via FALLBACK_PROVIDERS env var (comma-separated provider names).
 */

const NON_RETRYABLE_PATTERNS = [
  /\b(401|403)\b/,
  /\b(authenticat|unauthoriz|forbidden)\b/i,
  /\bapikey\b/i,
  /\binvalid.*key\b/i,
];

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  if (status === 401 || status === 403) return false;
  return !NON_RETRYABLE_PATTERNS.some((p) => p.test(msg));
}

export class FallbackAdapter implements LLMAdapter {
  get provider(): string {
    return this.adapters[0]?.provider ?? 'fallback';
  }

  get model(): string {
    return this.adapters[0]?.model ?? '';
  }

  constructor(private readonly adapters: LLMAdapter[]) {
    if (adapters.length === 0) {
      throw new Error('FallbackAdapter requires at least one adapter');
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    let lastError: unknown;
    for (let i = 0; i < this.adapters.length; i++) {
      const adapter = this.adapters[i];
      try {
        const resp = await adapter.complete(request);
        return resp;
      } catch (err) {
        lastError = err;
        const isLast = i === this.adapters.length - 1;
        if (isLast || !isRetryableError(err)) throw err;
        console.warn(
          `[FallbackAdapter] ${adapter.provider}/${adapter.model} failed, trying next provider: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    throw lastError;
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    let lastError: unknown;
    for (let i = 0; i < this.adapters.length; i++) {
      const adapter = this.adapters[i];
      try {
        if (adapter.stream) {
          yield* adapter.stream(request);
        } else {
          const resp = await adapter.complete(request);
          yield resp.content;
        }
        return;
      } catch (err) {
        lastError = err;
        const isLast = i === this.adapters.length - 1;
        if (isLast || !isRetryableError(err)) throw err;
        console.warn(
          `[FallbackAdapter] ${adapter.provider}/${adapter.model} stream failed, trying next provider: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    throw lastError;
  }

  async destroy(): Promise<void> {
    await Promise.all(
      this.adapters.map((a) => a.destroy?.()).filter(Boolean),
    );
  }
}
