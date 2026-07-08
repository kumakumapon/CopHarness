/**
 * Unit tests for lib/cache/cachedAdapter.ts
 */

import { CachedAdapter } from '../../lib/cache/cachedAdapter';
import { ResponseCache } from '../../lib/cache/responseCache';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../../lib/adapter';

function makeResponse(content = 'cached-content'): LLMResponse {
  return { content, model: 'test-model', provider: 'test' };
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

function makeMockAdapter(response: LLMResponse = makeResponse()): LLMAdapter & { complete: jest.Mock; stream?: jest.Mock; destroy: jest.Mock } {
  return {
    provider: 'test',
    model: 'test-model',
    complete: jest.fn().mockResolvedValue(response),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

describe('CachedAdapter – bypass when skills present', () => {
  it('calls inner.complete() directly when skills are provided (non-empty array)', async () => {
    const inner = makeMockAdapter();
    const cache = new ResponseCache();
    const adapter = new CachedAdapter(inner, cache);

    const request = makeRequest({ skills: [{ name: 'calculator', description: 'math', parameters: { type: 'object', properties: {} }, handler: jest.fn() }] });
    await adapter.complete(request);

    expect(inner.complete).toHaveBeenCalledTimes(1);
    // Should not have cached anything
    expect(cache.getStats().size).toBe(0);
  });

  it('uses cache when skills array is empty', async () => {
    const inner = makeMockAdapter();
    const cache = new ResponseCache();
    const adapter = new CachedAdapter(inner, cache);

    const request = makeRequest({ skills: [] });
    await adapter.complete(request);

    expect(inner.complete).toHaveBeenCalledTimes(1);
    expect(cache.getStats().size).toBe(1);
  });
});

describe('CachedAdapter – caching behaviour', () => {
  it('returns cached response on second identical request without calling inner again', async () => {
    const inner = makeMockAdapter(makeResponse('first-call'));
    const cache = new ResponseCache();
    const adapter = new CachedAdapter(inner, cache);

    const request = makeRequest();
    const r1 = await adapter.complete(request);
    const r2 = await adapter.complete(request);

    expect(inner.complete).toHaveBeenCalledTimes(1);
    expect(r1.content).toBe('first-call');
    expect(r2.content).toBe('first-call');
  });

  it('calls inner.complete() twice for requests with different messages', async () => {
    const inner = makeMockAdapter();
    const cache = new ResponseCache();
    const adapter = new CachedAdapter(inner, cache);

    await adapter.complete(makeRequest({ messages: [{ role: 'user', content: 'question A' }] }));
    await adapter.complete(makeRequest({ messages: [{ role: 'user', content: 'question B' }] }));

    expect(inner.complete).toHaveBeenCalledTimes(2);
  });

  it('exposes provider and model from inner adapter', () => {
    const inner = makeMockAdapter();
    const adapter = new CachedAdapter(inner, new ResponseCache());
    expect(adapter.provider).toBe('test');
    expect(adapter.model).toBe('test-model');
  });
});

describe('CachedAdapter – streaming', () => {
  it('delegates stream() to inner adapter when inner has a stream method', async () => {
    const chunks = ['chunk1', 'chunk2'];
    async function* innerStream(): AsyncGenerator<string> {
      for (const c of chunks) yield c;
    }

    const inner = {
      ...makeMockAdapter(),
      stream: jest.fn().mockReturnValue(innerStream()),
    };
    const adapter = new CachedAdapter(inner, new ResponseCache());

    const collected: string[] = [];
    for await (const chunk of adapter.stream(makeRequest())) {
      collected.push(chunk);
    }

    expect(inner.stream).toHaveBeenCalledTimes(1);
    expect(collected).toEqual(chunks);
  });

  it('falls back to complete() and yields content when inner has no stream method', async () => {
    const inner = makeMockAdapter(makeResponse('stream-fallback'));
    // Ensure no stream method
    const adapterWithoutStream: LLMAdapter = {
      provider: inner.provider,
      model: inner.model,
      complete: inner.complete,
      destroy: inner.destroy,
    };
    const adapter = new CachedAdapter(adapterWithoutStream, new ResponseCache());

    const collected: string[] = [];
    for await (const chunk of adapter.stream(makeRequest())) {
      collected.push(chunk);
    }

    expect(inner.complete).toHaveBeenCalledTimes(1);
    expect(collected).toEqual(['stream-fallback']);
  });
});

describe('CachedAdapter – destroy()', () => {
  it('delegates destroy() to inner adapter', async () => {
    const inner = makeMockAdapter();
    const adapter = new CachedAdapter(inner, new ResponseCache());
    await adapter.destroy();
    expect(inner.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when inner adapter has no destroy method', async () => {
    const inner: LLMAdapter = {
      provider: 'test',
      model: 'test-model',
      complete: jest.fn().mockResolvedValue(makeResponse()),
    };
    const adapter = new CachedAdapter(inner, new ResponseCache());
    await expect(adapter.destroy()).resolves.toBeUndefined();
  });
});
