import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { OpenAIAdapter } from './openaiAdapter';

export const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';

/**
 * Adapter for LM Studio local server.
 * LM Studio exposes an OpenAI-compatible REST API at http://localhost:1234/v1 by default.
 * No API key is required.
 */
export class LmStudioAdapter implements LLMAdapter {
  readonly provider = 'lmstudio';
  readonly model: string;
  private readonly delegate: OpenAIAdapter;

  constructor(model: string, apiBaseUrl?: string, timeoutMs = 30_000) {
    const baseURL = apiBaseUrl ?? process.env.LMSTUDIO_BASE_URL ?? LMSTUDIO_DEFAULT_BASE_URL;
    // LM Studio does not validate the API key; a placeholder value is used
    this.delegate = new OpenAIAdapter(model, 'lm-studio', baseURL, timeoutMs);
    this.model = model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const result = await this.delegate.complete(request);
    return { ...result, provider: 'lmstudio' };
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    yield* this.delegate.stream!(request);
  }
}
