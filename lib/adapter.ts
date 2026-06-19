/**
 * LLM provider abstraction layer.
 * Allows switching between Copilot, OpenAI, Anthropic, etc. at the command level.
 */

import { type SkillDefinition } from './skill';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMAttachment {
  type: 'blob';
  data: string;
  mimeType: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  attachments?: LLMAttachment[];
  timeoutMs?: number;
  model?: string;
  abortSignal?: AbortSignal;
  /** Optional list of skills (tools) the model may call during completion. */
  skills?: SkillDefinition[];
}

/** Token usage statistics returned by the LLM provider. */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Tokens used to create a new cache entry (Anthropic / future providers). */
  cacheCreationInputTokens?: number;
  /** Tokens read from an existing cache entry. */
  cacheReadInputTokens?: number;
}

export interface LLMResponse {
  content: string;
  model?: string;
  provider?: string;
  /** Token usage breakdown when available from the provider. */
  usage?: TokenUsage;
}

/**
 * Common interface for all LLM provider adapters.
 * Implement this to add a new provider (Copilot, OpenAI, Anthropic, etc.).
 */
export interface LLMAdapter {
  /** Name of the provider (e.g. "copilot", "openai", "anthropic"). */
  readonly provider: string;
  /** Current model used by this adapter. */
  readonly model: string;
  /** Send a conversation and await a response. */
  complete(request: LLMRequest): Promise<LLMResponse>;
  /** Stream a response token by token. Yields text chunks as they arrive. */
  stream?(request: LLMRequest): AsyncGenerator<string>;
  /** Optional cleanup (close connections, etc.). */
  destroy?(): Promise<void>;
}

export type ProviderType = 'copilot' | 'openai' | 'anthropic' | 'lemonade' | 'lmstudio' | 'antigravity';

export interface AdapterOptions {
  provider: ProviderType;
  model: string;
  apiKey?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
}
