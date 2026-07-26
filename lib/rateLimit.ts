import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface WindowEntry {
  timestamps: number[];
}

/**
 * Minimum interval between full stale-entry scans. Without this, a flood of
 * distinct keys makes every consume() call walk the whole store.
 */
const PRUNE_INTERVAL_MS = 1_000;

/** Sliding-window in-memory rate limiter. */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, WindowEntry>();
  private lastPruneAt = 0;

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

  /**
   * Drop the least recently inserted entries until the store fits the cap.
   * Map iteration follows insertion order, so this approximates LRU eviction
   * and guarantees the store stays bounded even when every key is still live.
   */
  private evictOldestEntries(target: number): void {
    for (const key of this.store.keys()) {
      if (this.store.size <= target) break;
      this.store.delete(key);
    }
  }

  /**
   * Keep the store bounded without turning every consume() into an O(n) scan:
   * full stale scans are throttled to once per PRUNE_INTERVAL_MS, and eviction
   * covers the gap in between.
   */
  private enforceStoreBounds(now: number): void {
    if (this.store.size < this.maxEntries) return;
    if (now - this.lastPruneAt >= PRUNE_INTERVAL_MS) {
      this.lastPruneAt = now;
      this.pruneStaleEntries();
    }
    // Runs before the caller inserts its own entry, so leave a free slot to
    // keep the store at maxEntries afterwards.
    this.evictOldestEntries(this.maxEntries - 1);
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
    const now = Date.now();
    this.enforceStoreBounds(now);
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

// ---------------------------------------------------------------------------
// Rate limit key derivation
// ---------------------------------------------------------------------------

/**
 * Minimal shape needed to derive a rate limit key. Both `NextRequest` and the
 * plain `Request` used by route handlers satisfy it.
 */
export interface RateLimitKeyCarrier {
  headers: { get(name: string): string | null };
}

/** Shared bucket used whenever no trustworthy per-client identity exists. */
export const GLOBAL_RATE_LIMIT_KEY = 'global';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

/** Strip an optional port and IPv6 brackets from a forwarded-for entry. */
function normalizeIp(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 1 ? value.slice(1, end).toLowerCase() : '';
  }
  // "1.2.3.4:5678" — a single colon means IPv4 with a port. Bare IPv6
  // addresses contain several colons and must be kept intact.
  const firstColon = value.indexOf(':');
  if (firstColon > -1 && value.indexOf(':', firstColon + 1) === -1) {
    return value.slice(0, firstColon).toLowerCase();
  }
  return value.toLowerCase();
}

function parseForwardedFor(header: string | null): string[] {
  if (!header) return [];
  return header.split(',').map(normalizeIp).filter(Boolean);
}

let cachedTrustedProxyIpsRaw: string | null = null;
let cachedTrustedProxyIps = new Set<string>();

function parseTrustedProxyIps(): Set<string> {
  const raw = process.env.TRUSTED_PROXY_IPS ?? '';
  if (raw === cachedTrustedProxyIpsRaw) return cachedTrustedProxyIps;

  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  // Matching is exact, so a CIDR block would never match a forwarded address
  // and the limiter would silently fall back to the global bucket. Say so
  // rather than letting the misconfiguration pass unnoticed.
  const cidrEntries = entries.filter((entry) => entry.includes('/'));
  if (cidrEntries.length > 0) {
    console.warn(
      `[rateLimit] TRUSTED_PROXY_IPS does not support CIDR notation; ignoring ${cidrEntries.join(', ')}. ` +
        'List proxy addresses individually, or use TRUSTED_PROXY_COUNT instead.',
    );
  }

  cachedTrustedProxyIps = new Set(
    entries.filter((entry) => !entry.includes('/')).map(normalizeIp).filter(Boolean),
  );
  cachedTrustedProxyIpsRaw = raw;
  return cachedTrustedProxyIps;
}

function parseTrustedProxyCount(): number {
  const raw = Number(process.env.TRUSTED_PROXY_COUNT);
  if (!Number.isFinite(raw) || raw < 1) return 0;
  return Math.floor(raw);
}

/**
 * Resolve the client address from `X-Forwarded-For`, but only as far as the
 * configured trusted proxies vouch for it. Clients can put anything in that
 * header, so with no trusted proxy configured we refuse to derive an address
 * at all rather than key the limiter on attacker-controlled input.
 *
 * `TRUSTED_PROXY_IPS` takes precedence over `TRUSTED_PROXY_COUNT`: walking the
 * chain right to left and stopping at the first address that is not a known
 * proxy is more robust than counting hops.
 */
function resolveClientIpFromForwardedFor(header: string | null): string | null {
  const chain = parseForwardedFor(header);
  if (chain.length === 0) return null;

  const trustedIps = parseTrustedProxyIps();
  if (trustedIps.size > 0) {
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const hop = chain[i]!;
      if (!trustedIps.has(hop)) return hop;
    }
    // Every hop is one of our own proxies: nothing identifies the client.
    return null;
  }

  const trustedHops = parseTrustedProxyCount();
  if (trustedHops > 0) {
    // Each trusted proxy appends the address it saw, so the client sits
    // `trustedHops` entries from the right. A shorter chain than configured
    // means the request did not traverse the expected path — fail closed.
    const index = chain.length - trustedHops;
    return index >= 0 ? chain[index]! : null;
  }

  return null;
}

/**
 * Single source of truth for rate limit bucket keys. Prefer the authenticated
 * API key, fall back to a proxy-vouched client IP, and otherwise share one
 * global bucket.
 *
 * Callers must run `requireApiKey()` before this, so any Bearer token seen
 * here has already been verified against `COPHARNESS_API_KEY`. Returned keys
 * are namespaced (`key:` / `ip:` / `global`) so the classes cannot collide.
 */
export function resolveRateLimitKey(req: RateLimitKeyCarrier): string {
  if (process.env.COPHARNESS_API_KEY) {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (token) return `key:${hashToken(token)}`;
  }

  const clientIp = resolveClientIpFromForwardedFor(req.headers.get('x-forwarded-for'));
  return clientIp ? `ip:${clientIp}` : GLOBAL_RATE_LIMIT_KEY;
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
