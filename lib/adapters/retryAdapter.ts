import type { LLMAdapter, LLMRequest, LLMResponse } from '../adapter';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Initial delay in milliseconds before the first retry (default: 1000). */
  initialDelayMs?: number;
  /** Multiplicative backoff factor applied on each retry (default: 2). */
  backoffFactor?: number;
  /** Upper bound on the computed delay in milliseconds (default: 30000). */
  maxDelayMs?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /server.?error/i,
  /service.?unavailable/i,
  /internal.?server.?error/i,
];

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

export function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status != null) {
    if (NON_RETRYABLE_STATUS_CODES.has(status)) return false;
    if (RETRYABLE_STATUS_CODES.has(status)) return true;
    // 5xx errors not explicitly listed
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // No status code — check the message text
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_MESSAGE_PATTERNS.some((p) => p.test(msg));
}

/**
 * Extract a Retry-After delay in milliseconds from an error object.
 * The header value may be provided as a numeric seconds string, a
 * Date string, or embedded in the error message like "retry-after: 5".
 */
function extractRetryAfterMs(err: unknown): number | undefined {
  const retryAfter = (err as { retryAfter?: string | number; headers?: Record<string, string> }).retryAfter
    ?? (err as { headers?: Record<string, string> }).headers?.['retry-after']
    ?? (err as { headers?: Record<string, string> }).headers?.['Retry-After'];

  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;
    // Could be an HTTP date — try parsing
    const date = Date.parse(String(retryAfter));
    if (!Number.isNaN(date)) {
      const ms = date - Date.now();
      if (ms > 0) return ms;
    }
  }

  // Also try extracting from error message: "retry-after: 5" or "retry after 5s"
  if (err instanceof Error) {
    const match = err.message.match(/retry.?after[:\s]+(\d+)/i);
    if (match) {
      const seconds = Number(match[1]);
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  }

  return undefined;
}

function resolveOptions(options?: RetryOptions): Required<RetryOptions> {
  return {
    maxRetries: options?.maxRetries
      ?? (process.env.RETRY_MAX_RETRIES != null ? Number(process.env.RETRY_MAX_RETRIES) : 3),
    initialDelayMs: options?.initialDelayMs
      ?? (process.env.RETRY_INITIAL_DELAY_MS != null ? Number(process.env.RETRY_INITIAL_DELAY_MS) : 1000),
    backoffFactor: options?.backoffFactor
      ?? (process.env.RETRY_BACKOFF_FACTOR != null ? Number(process.env.RETRY_BACKOFF_FACTOR) : 2),
    maxDelayMs: options?.maxDelayMs ?? 30000,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/**
 * Wraps an LLMAdapter with exponential-backoff retry logic.
 *
 * Retries on 429 (rate limit) and 5xx server errors. Non-retryable errors
 * (400, 401, 403, 404) are thrown immediately.
 *
 * Default options can be overridden via environment variables:
 *   RETRY_MAX_RETRIES, RETRY_INITIAL_DELAY_MS, RETRY_BACKOFF_FACTOR
 */
export class RetryAdapter implements LLMAdapter {
  private readonly opts: Required<RetryOptions>;

  get provider(): string { return this.inner.provider; }
  get model(): string { return this.inner.model; }

  constructor(private readonly inner: LLMAdapter, options?: RetryOptions) {
    this.opts = resolveOptions(options);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    let attempt = 0;
    let lastError: unknown;

    while (true) {
      try {
        return await this.inner.complete(request);
      } catch (err) {
        lastError = err;

        if (!isRetryableError(err) || attempt >= this.opts.maxRetries) {
          throw err;
        }

        const retryAfterMs = extractRetryAfterMs(err);
        const exponentialMs = this.opts.initialDelayMs * Math.pow(this.opts.backoffFactor, attempt);
        const delayMs = Math.min(retryAfterMs ?? exponentialMs, this.opts.maxDelayMs);

        attempt++;
        console.warn(
          `[RetryAdapter] ${this.inner.provider}/${this.inner.model} attempt ${attempt} failed, ` +
          `retrying in ${delayMs}ms (${attempt}/${this.opts.maxRetries}): ` +
          `${err instanceof Error ? err.message : err}`,
        );

        await sleep(delayMs, request.abortSignal);
      }
    }
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    let attempt = 0;

    while (true) {
      try {
        if (this.inner.stream) {
          yield* this.inner.stream(request);
        } else {
          const resp = await this.inner.complete(request);
          yield resp.content;
        }
        return;
      } catch (err) {
        if (!isRetryableError(err) || attempt >= this.opts.maxRetries) {
          throw err;
        }

        const retryAfterMs = extractRetryAfterMs(err);
        const exponentialMs = this.opts.initialDelayMs * Math.pow(this.opts.backoffFactor, attempt);
        const delayMs = Math.min(retryAfterMs ?? exponentialMs, this.opts.maxDelayMs);

        attempt++;
        console.warn(
          `[RetryAdapter] ${this.inner.provider}/${this.inner.model} stream attempt ${attempt} failed, ` +
          `retrying in ${delayMs}ms (${attempt}/${this.opts.maxRetries}): ` +
          `${err instanceof Error ? err.message : err}`,
        );

        await sleep(delayMs, request.abortSignal);
      }
    }
  }

  async destroy(): Promise<void> {
    return this.inner.destroy?.();
  }
}
