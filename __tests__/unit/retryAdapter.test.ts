import { RetryAdapter } from '../../lib/adapters/retryAdapter';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../../lib/adapter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dummyRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hello' }],
};

function makeError(message: string, status?: number, retryAfter?: string | number): Error {
  return Object.assign(new Error(message), { status, retryAfter });
}

function successAdapter(content = 'ok'): LLMAdapter {
  return {
    provider: 'test',
    model: 'test-model',
    async complete(): Promise<LLMResponse> {
      return { content, model: 'test-model', provider: 'test' };
    },
  };
}

/**
 * Creates an adapter that fails for the first `failTimes` calls then succeeds.
 */
function failThenSucceedAdapter(
  error: Error,
  failTimes: number,
  content = 'ok',
): LLMAdapter & { callCount: number } {
  let callCount = 0;
  return {
    provider: 'test',
    model: 'test-model',
    callCount: 0,
    async complete(): Promise<LLMResponse> {
      callCount++;
      (this as { callCount: number }).callCount = callCount;
      if (callCount <= failTimes) throw error;
      return { content, model: 'test-model', provider: 'test' };
    },
  };
}

function alwaysFailAdapter(error: Error): LLMAdapter {
  return {
    provider: 'test',
    model: 'test-model',
    async complete(): Promise<LLMResponse> {
      throw error;
    },
  };
}

function alwaysFailStreamAdapter(error: Error): LLMAdapter {
  return {
    provider: 'test',
    model: 'test-model',
    async complete(): Promise<LLMResponse> {
      throw error;
    },
    async *stream(): AsyncGenerator<string> {
      throw error;
    },
  };
}

function successStreamAdapter(chunks: string[]): LLMAdapter {
  return {
    provider: 'test',
    model: 'test-model',
    async complete(): Promise<LLMResponse> {
      return { content: chunks.join(''), model: 'test-model', provider: 'test' };
    },
    async *stream(): AsyncGenerator<string> {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function failThenSucceedStreamAdapter(
  error: Error,
  failTimes: number,
  chunks: string[],
): LLMAdapter {
  let callCount = 0;
  return {
    provider: 'test',
    model: 'test-model',
    async complete(): Promise<LLMResponse> {
      callCount++;
      if (callCount <= failTimes) throw error;
      return { content: chunks.join(''), model: 'test-model', provider: 'test' };
    },
    async *stream(): AsyncGenerator<string> {
      callCount++;
      if (callCount <= failTimes) throw error;
      for (const chunk of chunks) yield chunk;
    },
  };
}

// Use fake timers so delays are instant
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper to run async code that awaits timers
// ---------------------------------------------------------------------------
async function runWithTimers<T>(fn: () => Promise<T>): Promise<T> {
  const promise = fn();
  // Drain all pending timers/microtasks in a loop until settled
  await jest.runAllTimersAsync();
  return promise;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetryAdapter — complete()', () => {
  it('returns the response immediately on success (no retry)', async () => {
    const inner = successAdapter('hello world');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    const result = await adapter.complete(dummyRequest);
    expect(result.content).toBe('hello world');
  });

  it('exposes provider and model from the inner adapter', () => {
    const inner = successAdapter();
    const adapter = new RetryAdapter(inner);
    expect(adapter.provider).toBe('test');
    expect(adapter.model).toBe('test-model');
  });

  it('retries on 429 and succeeds on the second attempt', async () => {
    const err = makeError('Too Many Requests', 429);
    const inner = failThenSucceedAdapter(err, 1, 'success after retry');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 2 });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runWithTimers(() => adapter.complete(dummyRequest));

    expect(result.content).toBe('success after retry');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[RetryAdapter]');
  });

  it('retries on 500 error with exponential backoff', async () => {
    const err = makeError('Internal Server Error', 500);
    const inner = failThenSucceedAdapter(err, 2, 'eventually succeeded');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 1000, backoffFactor: 2 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runWithTimers(() => adapter.complete(dummyRequest));

    expect(result.content).toBe('eventually succeeded');
    // inner.complete was called 3 times total (2 failures + 1 success)
    expect(inner.callCount).toBe(3);
  });

  it('throws the last error when max retries are exceeded', async () => {
    const err = makeError('Service Unavailable', 503);
    const inner = alwaysFailAdapter(err);
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 2 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    let caughtError: unknown;
    const promise = adapter.complete(dummyRequest).catch((e) => { caughtError = e; });
    await jest.runAllTimersAsync();
    await promise;
    expect(caughtError).toBe(err);
  });

  it('does NOT retry on 401 Unauthorized', async () => {
    const err = makeError('Unauthorized', 401);
    const inner = alwaysFailAdapter(err);
    const completeSpy = jest.spyOn(inner, 'complete');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    await expect(adapter.complete(dummyRequest)).rejects.toThrow('Unauthorized');
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403 Forbidden', async () => {
    const err = makeError('Forbidden', 403);
    const inner = alwaysFailAdapter(err);
    const completeSpy = jest.spyOn(inner, 'complete');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    await expect(adapter.complete(dummyRequest)).rejects.toThrow('Forbidden');
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 400 Bad Request', async () => {
    const err = makeError('Bad Request', 400);
    const inner = alwaysFailAdapter(err);
    const completeSpy = jest.spyOn(inner, 'complete');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    await expect(adapter.complete(dummyRequest)).rejects.toThrow('Bad Request');
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404 Not Found', async () => {
    const err = makeError('Not Found', 404);
    const inner = alwaysFailAdapter(err);
    const completeSpy = jest.spyOn(inner, 'complete');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    await expect(adapter.complete(dummyRequest)).rejects.toThrow('Not Found');
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on "rate limit" message even without a status code', async () => {
    const err = makeError('rate limit exceeded');
    const inner = failThenSucceedAdapter(err, 1, 'ok after rate limit');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 1 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runWithTimers(() => adapter.complete(dummyRequest));
    expect(result.content).toBe('ok after rate limit');
  });

  it('retries on "service unavailable" message without status code', async () => {
    const err = makeError('service unavailable, please retry');
    const inner = failThenSucceedAdapter(err, 1, 'ok');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 1 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runWithTimers(() => adapter.complete(dummyRequest));
    expect(result.content).toBe('ok');
  });

  it('respects Retry-After value from error object', async () => {
    const err = makeError('Too Many Requests', 429, '5');
    const inner = failThenSucceedAdapter(err, 1, 'ok');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 2 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // With Retry-After: 5 seconds = 5000ms delay
    const advanceSpy = jest.spyOn(global, 'setTimeout');
    const result = await runWithTimers(() => adapter.complete(dummyRequest));

    expect(result.content).toBe('ok');
    // Verify the delay used was 5000ms (from Retry-After) rather than the exponential 100ms
    const calledDelays = advanceSpy.mock.calls.map((c) => c[1] as number);
    expect(calledDelays.some((d) => d >= 5000)).toBe(true);
  });

  it('respects Retry-After extracted from error message', async () => {
    const err = makeError('retry-after: 3 seconds', 429);
    const inner = failThenSucceedAdapter(err, 1, 'ok');
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 2 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const advanceSpy = jest.spyOn(global, 'setTimeout');
    const result = await runWithTimers(() => adapter.complete(dummyRequest));

    expect(result.content).toBe('ok');
    const calledDelays = advanceSpy.mock.calls.map((c) => c[1] as number);
    expect(calledDelays.some((d) => d >= 3000)).toBe(true);
  });

  it('caps delay at maxDelayMs', async () => {
    const err = makeError('Too Many Requests', 429);
    const inner = failThenSucceedAdapter(err, 1, 'ok');
    const adapter = new RetryAdapter(inner, {
      maxRetries: 3,
      initialDelayMs: 100000,
      backoffFactor: 2,
      maxDelayMs: 5000,
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const advanceSpy = jest.spyOn(global, 'setTimeout');
    await runWithTimers(() => adapter.complete(dummyRequest));

    const calledDelays = advanceSpy.mock.calls.map((c) => c[1] as number);
    expect(calledDelays.every((d) => d <= 5000)).toBe(true);
  });

  it('aborts the retry wait when AbortSignal is triggered', async () => {
    const err = makeError('Too Many Requests', 429);
    // Always fail so we reach the sleep
    const inner = alwaysFailAdapter(err);
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 60000, backoffFactor: 2 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const controller = new AbortController();
    const request: LLMRequest = { ...dummyRequest, abortSignal: controller.signal };

    const promise = adapter.complete(request);

    // Abort after the first attempt, during the 60s sleep
    controller.abort();

    // Advance timers slightly; the abort should interrupt the sleep
    jest.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow();
  });

  it('calls destroy() on the inner adapter', async () => {
    const destroyFn = jest.fn().mockResolvedValue(undefined);
    const inner = { ...successAdapter(), destroy: destroyFn };
    const adapter = new RetryAdapter(inner);

    await adapter.destroy();
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

describe('RetryAdapter — stream()', () => {
  it('yields chunks on success without retry', async () => {
    const inner = successStreamAdapter(['hello', ' world']);
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream(dummyRequest)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['hello', ' world']);
  });

  it('retries stream on 429 and yields chunks on second attempt', async () => {
    const err = makeError('Too Many Requests', 429);
    const inner = failThenSucceedStreamAdapter(err, 1, ['chunk1', 'chunk2']);
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 2 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const chunks: string[] = [];
    const gen = adapter.stream(dummyRequest);

    // Run in a loop, advancing timers to release sleeps
    const collectPromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await jest.runAllTimersAsync();
    await collectPromise;

    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });

  it('throws the last error when stream max retries exceeded', async () => {
    const err = makeError('Service Unavailable', 503);
    const inner = alwaysFailStreamAdapter(err);
    const adapter = new RetryAdapter(inner, { maxRetries: 2, initialDelayMs: 100, backoffFactor: 2 });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    let caughtError: unknown;
    const collectPromise = (async () => {
      for await (const _ of adapter.stream(dummyRequest)) { /* noop */ }
    })().catch((e) => { caughtError = e; });

    await jest.runAllTimersAsync();
    await collectPromise;
    expect(caughtError).toBe(err);
  });

  it('does NOT retry stream on 401', async () => {
    const err = makeError('Unauthorized', 401);
    const inner = alwaysFailStreamAdapter(err);
    const streamSpy = jest.spyOn(inner, 'stream' as keyof typeof inner);
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    let caughtError: unknown;
    const collectPromise = (async () => {
      for await (const _ of adapter.stream(dummyRequest)) { /* noop */ }
    })().catch((e) => { caughtError = e; });

    await jest.runAllTimersAsync();
    await collectPromise;
    expect(caughtError).toBe(err);
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to complete() when inner adapter has no stream method', async () => {
    const inner: LLMAdapter = {
      provider: 'test',
      model: 'test-model',
      async complete(): Promise<LLMResponse> {
        return { content: 'from complete', model: 'test-model', provider: 'test' };
      },
      // no stream method
    };
    const adapter = new RetryAdapter(inner, { maxRetries: 3, initialDelayMs: 100 });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream(dummyRequest)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['from complete']);
  });
});

// ---------------------------------------------------------------------------
// Env var defaults
// ---------------------------------------------------------------------------

describe('RetryAdapter — env var defaults', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    process.env = { ...savedEnv };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('reads maxRetries from RETRY_MAX_RETRIES env var', async () => {
    process.env.RETRY_MAX_RETRIES = '1';
    // maxRetries=1 means one retry maximum
    const err = makeError('Service Unavailable', 503);
    const inner = alwaysFailAdapter(err);
    const completeSpy = jest.spyOn(inner, 'complete');
    const adapter = new RetryAdapter(inner); // no options — reads from env
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    let caughtError: unknown;
    const promise = adapter.complete(dummyRequest).catch((e) => { caughtError = e; });
    await jest.runAllTimersAsync();
    await promise;
    expect(caughtError).toBe(err);
    // initial attempt + 1 retry = 2 calls total
    expect(completeSpy).toHaveBeenCalledTimes(2);
  });

  it('reads initialDelayMs from RETRY_INITIAL_DELAY_MS env var', async () => {
    process.env.RETRY_INITIAL_DELAY_MS = '500';
    const err = makeError('Too Many Requests', 429);
    const inner = failThenSucceedAdapter(err, 1, 'ok');
    const adapter = new RetryAdapter(inner);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const advanceSpy = jest.spyOn(global, 'setTimeout');
    await runWithTimers(() => adapter.complete(dummyRequest));

    const calledDelays = advanceSpy.mock.calls.map((c) => c[1] as number);
    expect(calledDelays.some((d) => d === 500)).toBe(true);
  });

  it('reads backoffFactor from RETRY_BACKOFF_FACTOR env var', async () => {
    process.env.RETRY_BACKOFF_FACTOR = '3';
    process.env.RETRY_INITIAL_DELAY_MS = '100';
    // With factor 3 and initial 100ms: attempt 0→100ms, attempt 1→300ms
    const err = makeError('Service Unavailable', 503);
    const inner = failThenSucceedAdapter(err, 2, 'ok');
    const adapter = new RetryAdapter(inner);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const advanceSpy = jest.spyOn(global, 'setTimeout');
    await runWithTimers(() => adapter.complete(dummyRequest));

    const calledDelays = advanceSpy.mock.calls.map((c) => c[1] as number);
    expect(calledDelays).toContain(100);
    expect(calledDelays).toContain(300);
  });
});
