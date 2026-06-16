import { NextResponse } from 'next/server';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface WindowEntry {
  timestamps: number[];
}

/** Sliding-window in-memory rate limiter. */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, WindowEntry>();

  constructor(windowMs = 60_000, maxRequests = 30, maxEntries = 10_000) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.maxEntries = maxEntries;
  }

  private cleanup(entry: WindowEntry, now: number): void {
    const cutoff = now - this.windowMs;
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  }

  private pruneStaleEntries(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [key, entry] of this.store) {
      if (entry.timestamps.every((t) => t <= cutoff)) {
        this.store.delete(key);
      }
    }
  }

  /** Check the current rate limit state for a key without consuming a slot. */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key) ?? { timestamps: [] };
    this.cleanup(entry, now);
    const count = entry.timestamps.length;
    const oldest = entry.timestamps[0];
    const resetAt = oldest != null ? oldest + this.windowMs : now + this.windowMs;
    return {
      allowed: count < this.maxRequests,
      remaining: Math.max(0, this.maxRequests - count),
      resetAt,
    };
  }

  /** Consume one slot for the key and return the updated rate limit state. */
  consume(key: string): RateLimitResult {
    if (this.store.size > this.maxEntries) {
      this.pruneStaleEntries();
    }
    const now = Date.now();
    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }
    this.cleanup(entry, now);
    const count = entry.timestamps.length;
    if (count >= this.maxRequests) {
      const oldest = entry.timestamps[0];
      const resetAt = oldest != null ? oldest + this.windowMs : now + this.windowMs;
      return { allowed: false, remaining: 0, resetAt };
    }
    entry.timestamps.push(now);
    const newCount = entry.timestamps.length;
    const oldest = entry.timestamps[0];
    const resetAt = oldest != null ? oldest + this.windowMs : now + this.windowMs;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - newCount),
      resetAt,
    };
  }
}

/** Singleton rate limiter configured from environment variables. */
export const defaultRateLimiter = new RateLimiter(
  Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
);

/** Returns a 429 NextResponse with standard rate limit headers. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const resetSec = Math.ceil(result.resetAt / 1000);
  const retryAfter = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too Many Requests' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(
          Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
        ),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(resetSec),
        'Retry-After': String(retryAfter),
      },
    },
  );
}
