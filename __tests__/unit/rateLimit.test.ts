/**
 * Unit tests for lib/rateLimit.ts
 */

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body: unknown, init?: ResponseInit) => ({
      status: (init as { status?: number })?.status ?? 200,
      headers: new Map(Object.entries((init as { headers?: Record<string, string> })?.headers ?? {})),
      json: async () => body,
    })),
  },
}));

import {
  RateLimiter,
  rateLimitResponse,
  resolveRateLimitKey,
  GLOBAL_RATE_LIMIT_KEY,
} from '../../lib/rateLimit';

/** Minimal request stand-in: resolveRateLimitKey only reads headers. */
function makeRequest(headers: Record<string, string> = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } };
}

describe('RateLimiter', () => {
  it('check() returns allowed=true and full remaining when under the limit', () => {
    const limiter = new RateLimiter(60_000, 5);
    const result = limiter.check('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
    expect(typeof result.resetAt).toBe('number');
  });

  it('consume() decrements remaining count', () => {
    const limiter = new RateLimiter(60_000, 5);
    const r1 = limiter.consume('user-2');
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(4);

    const r2 = limiter.consume('user-2');
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(3);
  });

  it('consume() returns allowed=false after maxRequests consumed', () => {
    const limiter = new RateLimiter(60_000, 3);
    limiter.consume('user-3');
    limiter.consume('user-3');
    limiter.consume('user-3');

    const r = limiter.consume('user-3');
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('check() does not consume a slot', () => {
    const limiter = new RateLimiter(60_000, 2);
    limiter.check('user-4');
    limiter.check('user-4');
    // Still able to consume both slots
    expect(limiter.consume('user-4').allowed).toBe(true);
    expect(limiter.consume('user-4').allowed).toBe(true);
    expect(limiter.consume('user-4').allowed).toBe(false);
  });

  it('expired timestamps are cleaned up after window elapses', async () => {
    const limiter = new RateLimiter(50, 3);
    limiter.consume('user-5');
    limiter.consume('user-5');
    limiter.consume('user-5');

    // Fully consumed — next consume should be blocked
    expect(limiter.consume('user-5').allowed).toBe(false);

    // Wait for the window to expire
    await new Promise<void>((resolve) => setTimeout(resolve, 80));

    // Old timestamps should be cleaned up; slots should be available again
    const r = limiter.consume('user-5');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  }, 500);

  it('different keys are tracked independently', () => {
    const limiter = new RateLimiter(60_000, 2);
    limiter.consume('key-a');
    limiter.consume('key-a');

    // key-a is now exhausted
    expect(limiter.consume('key-a').allowed).toBe(false);
    // key-b is still fresh
    expect(limiter.consume('key-b').allowed).toBe(true);
  });

  it('resetAt is a future timestamp', () => {
    const before = Date.now();
    const limiter = new RateLimiter(60_000, 5);
    const r = limiter.consume('user-6');
    expect(r.resetAt).toBeGreaterThan(before);
  });
});

describe('rateLimitResponse()', () => {
  it('returns a 429 response', () => {
    const result = { allowed: false, remaining: 0, resetAt: Date.now() + 30_000 };
    const res = rateLimitResponse(result);
    expect(res.status).toBe(429);
  });

  it('includes standard rate limit headers', () => {
    const resetAt = Date.now() + 30_000;
    const result = { allowed: false, remaining: 0, resetAt };
    const res = rateLimitResponse(result);

    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    expect(res.headers.get('Retry-After')).toBeDefined();
    expect(res.headers.get('X-RateLimit-Limit')).toBeDefined();
  });

  it('body contains error field with "Too Many Requests"', async () => {
    const result = { allowed: false, remaining: 0, resetAt: Date.now() + 10_000 };
    const res = rateLimitResponse(result);
    const body = await res.json();
    expect(body.error).toBe('Too Many Requests');
  });
});

describe('resolveRateLimitKey()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.COPHARNESS_API_KEY;
    delete process.env.TRUSTED_PROXY_COUNT;
    delete process.env.TRUSTED_PROXY_IPS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('without trusted proxy configuration', () => {
    it('ignores X-Forwarded-For and falls back to the global bucket', () => {
      const key = resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '203.0.113.7' }));
      expect(key).toBe(GLOBAL_RATE_LIMIT_KEY);
    });

    it('cannot be bypassed by varying X-Forwarded-For per request', () => {
      const keys = new Set(
        ['1.1.1.1', '2.2.2.2', '3.3.3.3', 'not-an-ip'].map((ip) =>
          resolveRateLimitKey(makeRequest({ 'x-forwarded-for': ip })),
        ),
      );
      expect(keys).toEqual(new Set([GLOBAL_RATE_LIMIT_KEY]));
    });

    it('returns the global bucket when no headers are present', () => {
      expect(resolveRateLimitKey(makeRequest())).toBe(GLOBAL_RATE_LIMIT_KEY);
    });
  });

  describe('with TRUSTED_PROXY_COUNT', () => {
    it('keys on the address vouched for by the trusted hop', () => {
      process.env.TRUSTED_PROXY_COUNT = '1';
      const key = resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '203.0.113.7' }));
      expect(key).toBe('ip:203.0.113.7');
    });

    it('skips a client-supplied prefix in the forwarded chain', () => {
      process.env.TRUSTED_PROXY_COUNT = '1';
      const key = resolveRateLimitKey(
        makeRequest({ 'x-forwarded-for': 'spoofed.example, 203.0.113.7' }),
      );
      expect(key).toBe('ip:203.0.113.7');
    });

    it('honours multiple trusted hops', () => {
      process.env.TRUSTED_PROXY_COUNT = '2';
      const key = resolveRateLimitKey(
        makeRequest({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1, 10.0.0.2' }),
      );
      expect(key).toBe('ip:10.0.0.1');
    });

    it('fails closed when the chain is shorter than the configured hop count', () => {
      process.env.TRUSTED_PROXY_COUNT = '3';
      const key = resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '203.0.113.7' }));
      expect(key).toBe(GLOBAL_RATE_LIMIT_KEY);
    });

    it('ignores a non-positive or malformed hop count', () => {
      process.env.TRUSTED_PROXY_COUNT = '0';
      expect(resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '203.0.113.7' }))).toBe(
        GLOBAL_RATE_LIMIT_KEY,
      );
      process.env.TRUSTED_PROXY_COUNT = 'abc';
      expect(resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '203.0.113.7' }))).toBe(
        GLOBAL_RATE_LIMIT_KEY,
      );
    });

    it('strips a port from an IPv4 entry', () => {
      process.env.TRUSTED_PROXY_COUNT = '1';
      const key = resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '203.0.113.7:41234' }));
      expect(key).toBe('ip:203.0.113.7');
    });

    it('keeps a bracketed IPv6 address intact', () => {
      process.env.TRUSTED_PROXY_COUNT = '1';
      const key = resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '[2001:db8::1]:443' }));
      expect(key).toBe('ip:2001:db8::1');
    });

    it('keeps a bare IPv6 address intact', () => {
      process.env.TRUSTED_PROXY_COUNT = '1';
      const key = resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '2001:DB8::1' }));
      expect(key).toBe('ip:2001:db8::1');
    });
  });

  describe('with TRUSTED_PROXY_IPS', () => {
    it('walks right to left past known proxies to the client address', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,10.0.0.2';
      const key = resolveRateLimitKey(
        makeRequest({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2, 10.0.0.1' }),
      );
      expect(key).toBe('ip:203.0.113.7');
    });

    it('falls back to the global bucket when every hop is a known proxy', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,10.0.0.2';
      const key = resolveRateLimitKey(
        makeRequest({ 'x-forwarded-for': '10.0.0.2, 10.0.0.1' }),
      );
      expect(key).toBe(GLOBAL_RATE_LIMIT_KEY);
    });

    it('takes precedence over TRUSTED_PROXY_COUNT', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1';
      process.env.TRUSTED_PROXY_COUNT = '3';
      const key = resolveRateLimitKey(
        makeRequest({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
      );
      expect(key).toBe('ip:203.0.113.7');
    });
  });

  describe('with API key authentication enabled', () => {
    beforeEach(() => {
      process.env.COPHARNESS_API_KEY = 'secret-key';
    });

    it('keys on the presented API key rather than the network address', () => {
      const key = resolveRateLimitKey(
        makeRequest({ authorization: 'Bearer secret-key', 'x-forwarded-for': '203.0.113.7' }),
      );
      expect(key).toMatch(/^key:[0-9a-f]{32}$/);
    });

    it('does not leak the key itself into the bucket name', () => {
      const key = resolveRateLimitKey(makeRequest({ authorization: 'Bearer secret-key' }));
      expect(key).not.toContain('secret-key');
    });

    it('gives distinct keys distinct buckets', () => {
      const a = resolveRateLimitKey(makeRequest({ authorization: 'Bearer key-a' }));
      const b = resolveRateLimitKey(makeRequest({ authorization: 'Bearer key-b' }));
      expect(a).not.toBe(b);
    });

    it('is stable across requests carrying the same key', () => {
      const a = resolveRateLimitKey(makeRequest({ authorization: 'Bearer secret-key' }));
      const b = resolveRateLimitKey(makeRequest({ authorization: 'Bearer secret-key' }));
      expect(a).toBe(b);
    });

    it('falls back to address-based keying when no Bearer token is present', () => {
      process.env.TRUSTED_PROXY_COUNT = '1';
      const key = resolveRateLimitKey(makeRequest({ 'x-forwarded-for': '203.0.113.7' }));
      expect(key).toBe('ip:203.0.113.7');
    });

    it('ignores a Bearer token when authentication is disabled', () => {
      delete process.env.COPHARNESS_API_KEY;
      const key = resolveRateLimitKey(makeRequest({ authorization: 'Bearer anything' }));
      expect(key).toBe(GLOBAL_RATE_LIMIT_KEY);
    });
  });
});

describe('RateLimiter store bounds', () => {
  it('keeps the store bounded when flooded with distinct keys', () => {
    const limiter = new RateLimiter(60_000, 5, 10);
    for (let i = 0; i < 500; i += 1) {
      limiter.consume(`key-${i}`);
    }
    // The most recent key must still have a live window despite eviction.
    expect(limiter.check('key-499').remaining).toBeLessThan(5);
    // @ts-expect-error -- reading the private store to assert the bound holds.
    expect((limiter.store as Map<string, unknown>).size).toBeLessThanOrEqual(10);
  });
});

describe('resolveRateLimitKey() misconfiguration', () => {
  const originalEnv = process.env;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.COPHARNESS_API_KEY;
    delete process.env.TRUSTED_PROXY_COUNT;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    warnSpy.mockRestore();
  });

  it('warns and ignores CIDR entries in TRUSTED_PROXY_IPS', () => {
    process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8';
    const key = resolveRateLimitKey(
      makeRequest({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
    );
    // No usable trusted proxy remains, so the address is not trusted.
    expect(key).toBe(GLOBAL_RATE_LIMIT_KEY);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CIDR'));
  });

  it('still honours the individually listed addresses alongside a CIDR entry', () => {
    process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8, 10.0.0.1';
    const key = resolveRateLimitKey(
      makeRequest({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
    );
    expect(key).toBe('ip:203.0.113.7');
  });
});
