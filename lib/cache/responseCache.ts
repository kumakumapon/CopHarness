import { createHash } from 'crypto';
import type { LLMMessage, LLMResponse } from '../adapter';

interface CacheEntry {
  response: LLMResponse;
  createdAt: number;
  hits: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 200, ttlMs = 300_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /** Build a cache key from provider + model + messages. */
  static buildKey(provider: string, model: string, messages: LLMMessage[]): string {
    const payload = JSON.stringify({ provider, model, messages });
    return createHash('sha256').update(payload).digest('hex');
  }

  get(key: string): LLMResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }
    entry.hits++;
    this.stats.hits++;
    return entry.response;
  }

  set(key: string, response: LLMResponse): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }
    this.cache.set(key, { response, createdAt: Date.now(), hits: 0 });
  }

  getStats(): CacheStats {
    return {
      size: this.cache.size,
      ...this.stats,
    };
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Singleton cache instance. Disabled when LLM_CACHE_ENABLED is not 'true'. */
export const responseCache = new ResponseCache(
  Number(process.env.LLM_CACHE_MAX_ENTRIES) || 200,
  Number(process.env.LLM_CACHE_TTL_MS) || 300_000,
);

export function isCacheEnabled(): boolean {
  return process.env.LLM_CACHE_ENABLED === 'true';
}
