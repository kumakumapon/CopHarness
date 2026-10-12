import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { OpenAIAdapter } from './openaiAdapter';

export const LEMONADE_DEFAULT_BASE_URL = 'http://localhost:8000/api/v0';

/**
 * Adapter for AMD Lemonade Server local inference server.
 * Lemonade Server exposes an OpenAI-compatible REST API at http://localhost:8000/api/v0 by default.
 * No API key is required.
 */
export class LemonadeAdapter implements LLMAdapter {
  readonly provider = 'lemonade';
  readonly model: string;
  private readonly delegate: OpenAIAdapter;

  constructor(model: string, apiBaseUrl?: string, timeoutMs = 30_000) {
    const baseURL = apiBaseUrl ?? process.env.LEMONADE_BASE_URL ?? LEMONADE_DEFAULT_BASE_URL;
    // Lemonade Server does not validate the API key; a placeholder value is used
    this.delegate = new OpenAIAdapter(model, 'lemonade', baseURL, timeoutMs);
    this.model = model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const result = await this.delegate.complete(request);
    return { ...result, provider: 'lemonade' };
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    yield* this.delegate.stream!(request);
  }
}
