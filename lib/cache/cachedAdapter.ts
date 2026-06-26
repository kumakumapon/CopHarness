import type { LLMAdapter, LLMRequest, LLMResponse } from '../adapter';
import { ResponseCache, responseCache, isCacheEnabled } from './responseCache';

export class CachedAdapter implements LLMAdapter {
  get provider(): string { return this.inner.provider; }
  get model(): string { return this.inner.model; }

  constructor(
    private readonly inner: LLMAdapter,
    private readonly cache: ResponseCache = responseCache,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Only cache when skills are not involved (tool use makes responses non-deterministic)
    if (request.skills && request.skills.length > 0) {
      return this.inner.complete(request);
    }

    const key = ResponseCache.buildKey(this.inner.provider, this.inner.model, request.messages);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const response = await this.inner.complete(request);
    this.cache.set(key, response);
    return response;
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    // Streaming bypasses cache - use complete() for cacheable requests
    if (this.inner.stream) {
      yield* this.inner.stream(request);
    } else {
      const resp = await this.complete(request);
      yield resp.content;
    }
  }

  async destroy(): Promise<void> {
    return this.inner.destroy?.();
  }
}

