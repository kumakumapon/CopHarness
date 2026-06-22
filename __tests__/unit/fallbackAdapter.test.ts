import { FallbackAdapter } from '../../lib/adapters/fallbackAdapter';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../../lib/adapter';

function mockAdapter(
  provider: string,
  model: string,
  behaviour: 'succeed' | 'fail-retryable' | 'fail-auth',
  content = 'ok',
): LLMAdapter {
  return {
    provider,
    model,
    async complete(): Promise<LLMResponse> {
      if (behaviour === 'fail-retryable') {
        throw Object.assign(new Error('Service unavailable'), { status: 503 });
      }
      if (behaviour === 'fail-auth') {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }
      return { content, model, provider };
    },
  };
}

function asyncGenAdapter(
  provider: string,
  model: string,
  chunks: string[],
): LLMAdapter {
  return {
    provider,
    model,
    async complete(): Promise<LLMResponse> {
      return { content: chunks.join(''), model, provider };
    },
    async *stream(): AsyncGenerator<string> {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function failStreamAdapter(
  provider: string,
  model: string,
): LLMAdapter {
  return {
    provider,
    model,
    async complete(): Promise<LLMResponse> {
      throw new Error('timeout');
    },
    async *stream(): AsyncGenerator<string> {
      throw new Error('stream timeout');
    },
  };
}

const dummyRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hello' }],
};

describe('FallbackAdapter', () => {
  it('throws when constructed with zero adapters', () => {
    expect(() => new FallbackAdapter([])).toThrow('at least one adapter');
  });

  it('returns the primary adapter response on success', async () => {
    const primary = mockAdapter('openai', 'gpt-4', 'succeed', 'primary response');
    const fallback = mockAdapter('anthropic', 'claude', 'succeed', 'fallback response');
    const adapter = new FallbackAdapter([primary, fallback]);

    const resp = await adapter.complete(dummyRequest);
    expect(resp.content).toBe('primary response');
    expect(resp.provider).toBe('openai');
  });

  it('falls back on retryable error', async () => {
    const primary = mockAdapter('openai', 'gpt-4', 'fail-retryable');
    const fallback = mockAdapter('anthropic', 'claude', 'succeed', 'fallback response');
    const adapter = new FallbackAdapter([primary, fallback]);

    const resp = await adapter.complete(dummyRequest);
    expect(resp.content).toBe('fallback response');
    expect(resp.provider).toBe('anthropic');
  });

  it('does not fall back on auth error', async () => {
    const primary = mockAdapter('openai', 'gpt-4', 'fail-auth');
    const fallback = mockAdapter('anthropic', 'claude', 'succeed', 'fallback response');
    const adapter = new FallbackAdapter([primary, fallback]);

    await expect(adapter.complete(dummyRequest)).rejects.toThrow('Unauthorized');
  });

  it('throws original error when all adapters fail', async () => {
    const a = mockAdapter('openai', 'gpt-4', 'fail-retryable');
    const b = mockAdapter('anthropic', 'claude', 'fail-retryable');
    const adapter = new FallbackAdapter([a, b]);

    await expect(adapter.complete(dummyRequest)).rejects.toThrow('Service unavailable');
  });

  it('exposes provider and model from the first adapter', () => {
    const primary = mockAdapter('openai', 'gpt-4', 'succeed');
    const adapter = new FallbackAdapter([primary]);
    expect(adapter.provider).toBe('openai');
    expect(adapter.model).toBe('gpt-4');
  });

  it('falls back on stream error', async () => {
    const primary = failStreamAdapter('openai', 'gpt-4');
    const fallback = asyncGenAdapter('anthropic', 'claude', ['hello', ' world']);
    const adapter = new FallbackAdapter([primary, fallback]);

    const chunks: string[] = [];
    for await (const chunk of adapter.stream(dummyRequest)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['hello', ' world']);
  });

  it('yields from primary on stream success', async () => {
    const primary = asyncGenAdapter('openai', 'gpt-4', ['chunk1', 'chunk2']);
    const adapter = new FallbackAdapter([primary]);

    const chunks: string[] = [];
    for await (const chunk of adapter.stream(dummyRequest)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });

  it('calls destroy on all adapters', async () => {
    const destroyA = jest.fn();
    const destroyB = jest.fn();
    const a = { ...mockAdapter('a', 'x', 'succeed'), destroy: destroyA };
    const b = { ...mockAdapter('b', 'y', 'succeed'), destroy: destroyB };
    const adapter = new FallbackAdapter([a, b]);

    await adapter.destroy();
    expect(destroyA).toHaveBeenCalled();
    expect(destroyB).toHaveBeenCalled();
  });

  it('falls through three adapters', async () => {
    const a = mockAdapter('openai', 'gpt-4', 'fail-retryable');
    const b = mockAdapter('anthropic', 'claude', 'fail-retryable');
    const c = mockAdapter('antigravity', 'gemini', 'succeed', 'third provider');
    const adapter = new FallbackAdapter([a, b, c]);

    const resp = await adapter.complete(dummyRequest);
    expect(resp.content).toBe('third provider');
    expect(resp.provider).toBe('antigravity');
  });
});
