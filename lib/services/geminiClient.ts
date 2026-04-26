/**
 * Low-level HTTP client for the Google Gemini API.
 * Handles retries with exponential back-off, timeouts, and structured error mapping.
 *
 * Environment variables (read by the factory / adapter):
 *   GEMINI_API_KEY       – required
 *   GEMINI_ENDPOINT      – optional override (default: https://generativelanguage.googleapis.com/v1beta)
 *   GEMINI_TIMEOUT_MS    – optional (default: 10 000)
 *   GEMINI_RETRY_MAX     – optional (default: 3)
 */

import { mergeAbortSignals } from '../utils/abort';

export const GEMINI_DEFAULT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_TIMEOUT_MS = 10_000;
export const GEMINI_DEFAULT_RETRY_MAX = 3;

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class GeminiAPIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(`Gemini API error (${status}): ${message}`);
    this.name = 'GeminiAPIError';
  }
}

// ---------------------------------------------------------------------------
// Payload types (Gemini REST API v1beta)
// ---------------------------------------------------------------------------

export interface GeminiInlineData {
  mimeType: string;
  data: string;
}

export type GeminiPart =
  | { text: string; inlineData?: never }
  | { inlineData: GeminiInlineData; text?: never };

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiRequestPayload {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: { temperature?: number };
}

export interface GeminiResponseCandidate {
  content: {
    role: string;
    parts: GeminiPart[];
  };
  finishReason?: string;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiResponsePayload {
  candidates: GeminiResponseCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retryMax: number;

  constructor(
    apiKey: string,
    endpoint: string = GEMINI_DEFAULT_ENDPOINT,
    timeoutMs: number = GEMINI_DEFAULT_TIMEOUT_MS,
    retryMax: number = GEMINI_DEFAULT_RETRY_MAX,
  ) {
    this.apiKey = apiKey;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.retryMax = retryMax;
  }

  async request(
    model: string,
    payload: GeminiRequestPayload,
    options?: { signal?: AbortSignal },
  ): Promise<GeminiResponsePayload> {
    const url = `${this.endpoint}/models/${model}:generateContent`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryMax; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8_000);
        await sleep(backoffMs);
      }

      const { signal, cleanup } = mergeAbortSignals(this.timeoutMs, options?.signal);
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(payload),
        });
      } catch (err: unknown) {
        cleanup();
        const isTimeout =
          err instanceof Error &&
          (err.name === 'TimeoutError' || err.name === 'AbortError');
        if (isTimeout) {
          const timeoutErr = Object.assign(
            new Error(`Gemini request timed out after ${this.timeoutMs}ms`),
            { name: 'TimeoutError' },
          );
          throw timeoutErr;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retryMax) continue;
        throw lastError;
      }
      cleanup();

      if (resp.ok) {
        return (await resp.json()) as GeminiResponsePayload;
      }

      const body = await resp.text().catch(() => resp.statusText);
      console.warn(
        `[GeminiClient] HTTP ${resp.status} on attempt ${attempt + 1}`,
        { status: resp.status },
      );
      lastError = new GeminiAPIError(resp.status, body, body);

      const shouldRetry = resp.status === 429 || resp.status >= 500;
      if (!shouldRetry || attempt >= this.retryMax) {
        throw lastError;
      }
    }

    throw lastError ?? new Error('Gemini request failed after retries');
  }
}
