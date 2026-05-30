import { startSpan } from './tracer';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../adapter';

export class InstrumentedAdapter implements LLMAdapter {
  get provider(): string { return this.inner.provider; }
  get model(): string { return this.inner.model; }

  constructor(private readonly inner: LLMAdapter) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const span = startSpan('llm.complete', {
      'llm.provider': this.inner.provider,
      'llm.model': this.inner.model,
      'llm.messages.count': request.messages.length,
      ...(request.skills ? { 'llm.skills.count': request.skills.length } : {}),
    });
    try {
      const resp = await this.inner.complete(request);
      span.end({
        'llm.response.model': resp.model ?? '',
        'llm.response.length': resp.content.length,
      });
      return resp;
    } catch (err) {
      span.end({}, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    if (!this.inner.stream) {
      const resp = await this.complete(request);
      yield resp.content;
      return;
    }
    const span = startSpan('llm.stream', {
      'llm.provider': this.inner.provider,
      'llm.model': this.inner.model,
    });
    let chunkCount = 0;
    try {
      for await (const chunk of this.inner.stream(request)) {
        chunkCount++;
        yield chunk;
      }
      span.end({ 'llm.stream.chunks': chunkCount });
    } catch (err) {
      span.end({ 'llm.stream.chunks': chunkCount }, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async destroy(): Promise<void> {
    return this.inner.destroy?.();
  }
}
