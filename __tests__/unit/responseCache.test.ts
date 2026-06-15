/**
 * Unit tests for lib/cache/responseCache.ts
 */

import { ResponseCache } from '../../lib/cache/responseCache';
import type { LLMResponse, LLMMessage } from '../../lib/adapter';

function makeResponse(content = 'hello'): LLMResponse {
  return { content, model: 'test-model', provider: 'test' };
}

const MSG: LLMMessage[] = [{ role: 'user', content: 'hi' }];

describe('ResponseCache – get/set', () => {
  it('get() returns undefined for a cache miss', () => {
    const cache = new ResponseCache();
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('set() then get() returns the cached response', () => {
    const cache = new ResponseCache();
    const resp = makeResponse('world');
    cache.set('key1', resp);
    expect(cache.get('key1')).toEqual(resp);
  });

  it('get() for a different key still returns undefined', () => {
    const cache = new ResponseCache();
    cache.set('key-a', makeResponse());
    expect(cache.get('key-b')).toBeUndefined();
  });
});

describe('ResponseCache – TTL expiry', () => {
  it('returns undefined after TTL elapses', async () => {
    const cache = new ResponseCache(200, 50); // 50 ms TTL
    cache.set('expiring', makeResponse('temp'));
    expect(cache.get('expiring')).toBeDefined();

    await new Promise<void>((resolve) => setTimeout(resolve, 80));

    expect(cache.get('expiring')).toBeUndefined();
  }, 500);

  it('still returns value before TTL elapses', async () => {
    const cache = new ResponseCache(200, 200); // 200 ms TTL
    cache.set('fresh', makeResponse('fresh'));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(cache.get('fresh')).toBeDefined();
  }, 500);
});

describe('ResponseCache – eviction', () => {
  it('evicts oldest entry when maxEntries is exceeded', () => {
    const cache = new ResponseCache(3, 300_000);
    cache.set('k1', makeResponse('r1'));
    cache.set('k2', makeResponse('r2'));
    cache.set('k3', makeResponse('r3'));
    // Adding a 4th entry should evict 'k1'
    cache.set('k4', makeResponse('r4'));
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k4')).toBeDefined();
  });
});

describe('ResponseCache – getStats()', () => {
  it('tracks hits and misses', () => {
    const cache = new ResponseCache();
    cache.set('s1', makeResponse());
    cache.get('s1');  // hit
    cache.get('s1');  // hit
    cache.get('miss'); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });

  it('tracks evictions', () => {
    const cache = new ResponseCache(2, 300_000);
    cache.set('e1', makeResponse());
    cache.set('e2', makeResponse());
    cache.set('e3', makeResponse()); // triggers eviction of e1

    const stats = cache.getStats();
    expect(stats.evictions).toBe(1);
  });

  it('reports correct size', () => {
    const cache = new ResponseCache();
    cache.set('a', makeResponse());
    cache.set('b', makeResponse());
    expect(cache.getStats().size).toBe(2);
  });
});

describe('ResponseCache – buildKey()', () => {
  it('produces a non-empty string key', () => {
    const key = ResponseCache.buildKey('copilot', 'gpt-4', MSG);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('produces different keys for different providers', () => {
    const k1 = ResponseCache.buildKey('openai', 'gpt-4', MSG);
    const k2 = ResponseCache.buildKey('anthropic', 'gpt-4', MSG);
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different models', () => {
    const k1 = ResponseCache.buildKey('openai', 'gpt-3', MSG);
    const k2 = ResponseCache.buildKey('openai', 'gpt-4', MSG);
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different messages', () => {
    const msgs1: LLMMessage[] = [{ role: 'user', content: 'hello' }];
    const msgs2: LLMMessage[] = [{ role: 'user', content: 'goodbye' }];
    const k1 = ResponseCache.buildKey('openai', 'gpt-4', msgs1);
    const k2 = ResponseCache.buildKey('openai', 'gpt-4', msgs2);
    expect(k1).not.toBe(k2);
  });

  it('produces the same key for identical inputs', () => {
    const k1 = ResponseCache.buildKey('openai', 'gpt-4', MSG);
    const k2 = ResponseCache.buildKey('openai', 'gpt-4', MSG);
    expect(k1).toBe(k2);
  });
});

describe('ResponseCache – clear()', () => {
  it('empties the cache', () => {
    const cache = new ResponseCache();
    cache.set('x', makeResponse());
    cache.set('y', makeResponse());
    cache.clear();
    expect(cache.get('x')).toBeUndefined();
    expect(cache.get('y')).toBeUndefined();
    expect(cache.getStats().size).toBe(0);
  });
});
