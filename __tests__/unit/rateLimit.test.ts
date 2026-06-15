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

import { RateLimiter, rateLimitResponse } from '../../lib/rateLimit';

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
