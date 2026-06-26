import { startSpan } from './tracer';
import { recordTokenUsage } from './tokenTracker';
import { eventBus } from '../events/bus';
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
    const startMs = Date.now();

    eventBus.emit('adapter:request', {
      provider: this.inner.provider,
      model: this.inner.model,
      messageCount: request.messages.length,
      hasSkills: (request.skills?.length ?? 0) > 0,
    });

    try {
      const resp = await this.inner.complete(request);
      const durationMs = Date.now() - startMs;
      span.end({
        'llm.response.model': resp.model ?? '',
        'llm.response.length': resp.content.length,
        ...(resp.usage?.promptTokens != null ? { 'llm.usage.prompt_tokens': resp.usage.promptTokens } : {}),
        ...(resp.usage?.completionTokens != null ? { 'llm.usage.completion_tokens': resp.usage.completionTokens } : {}),
        ...(resp.usage?.totalTokens != null ? { 'llm.usage.total_tokens': resp.usage.totalTokens } : {}),
      });
      if (resp.usage) {
        recordTokenUsage(this.inner.provider, resp.model ?? this.inner.model, resp.usage);
      }

      eventBus.emit('adapter:response', {
        provider: this.inner.provider,
        model: resp.model ?? this.inner.model,
        durationMs,
        contentLength: resp.content.length,
        usage: resp.usage ? {
          promptTokens: resp.usage.promptTokens,
          completionTokens: resp.usage.completionTokens,
          totalTokens: resp.usage.totalTokens,
        } : undefined,
      });

      return resp;
    } catch (err) {
      const durationMs = Date.now() - startMs;
      span.end({}, err instanceof Error ? err : new Error(String(err)));

      const errMsg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      const retryable = status === 429 || (status !== undefined && status >= 500);
      eventBus.emit('adapter:error', {
        provider: this.inner.provider,
        model: this.inner.model,
        error: errMsg,
        durationMs,
        retryable,
      });

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
    const startMs = Date.now();

    eventBus.emit('adapter:request', {
      provider: this.inner.provider,
      model: this.inner.model,
      messageCount: request.messages.length,
      hasSkills: (request.skills?.length ?? 0) > 0,
    });

    let chunkCount = 0;
    let totalLength = 0;
    try {
      for await (const chunk of this.inner.stream(request)) {
        chunkCount++;
        totalLength += chunk.length;
        yield chunk;
      }

      const streamUsage = this.inner.lastStreamUsage;
      span.end({
        'llm.stream.chunks': chunkCount,
        ...(streamUsage?.promptTokens != null ? { 'llm.usage.prompt_tokens': streamUsage.promptTokens } : {}),
        ...(streamUsage?.completionTokens != null ? { 'llm.usage.completion_tokens': streamUsage.completionTokens } : {}),
        ...(streamUsage?.totalTokens != null ? { 'llm.usage.total_tokens': streamUsage.totalTokens } : {}),
      });
      if (streamUsage) {
        recordTokenUsage(this.inner.provider, this.inner.model, streamUsage);
      }

      eventBus.emit('adapter:response', {
        provider: this.inner.provider,
        model: this.inner.model,
        durationMs: Date.now() - startMs,
        contentLength: totalLength,
        usage: streamUsage ? {
          promptTokens: streamUsage.promptTokens,
          completionTokens: streamUsage.completionTokens,
          totalTokens: streamUsage.totalTokens,
        } : undefined,
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      span.end({ 'llm.stream.chunks': chunkCount }, err instanceof Error ? err : new Error(String(err)));

      const errMsg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      const retryable = status === 429 || (status !== undefined && status >= 500);
      eventBus.emit('adapter:error', {
        provider: this.inner.provider,
        model: this.inner.model,
        error: errMsg,
        durationMs,
        retryable,
      });

      throw err;
    }
  }

  async destroy(): Promise<void> {
    return this.inner.destroy?.();
  }
}
