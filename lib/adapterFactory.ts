import { type LLMAdapter, type AdapterOptions, type ProviderType } from './adapter';
import { CopilotAdapter } from './adapters/copilotAdapter';
import { OpenAIAdapter } from './adapters/openaiAdapter';
import { AnthropicAdapter } from './adapters/anthropicAdapter';
import { GeminiAdapter } from './adapters/geminiAdapter';
import {
  GEMINI_DEFAULT_ENDPOINT,
  GEMINI_DEFAULT_TIMEOUT_MS,
  GEMINI_DEFAULT_RETRY_MAX,
} from './services/geminiClient';
// 他のアダプタも必要に応じて追加

/**
 * Creates the appropriate LLM adapter based on the given options.
 * Falls back to the Copilot SDK when no explicit provider is configured.
 */
export function createAdapter(options: AdapterOptions): LLMAdapter {
  switch (options.provider) {
    case 'openai':
      if (!options.apiKey) throw new Error('apiKey is required for the OpenAI adapter');
      return new OpenAIAdapter(
        options.model,
        options.apiKey,
        options.apiBaseUrl,
        options.timeoutMs,
      );
    case 'anthropic':
      if (!options.apiKey) throw new Error('apiKey is required for the Anthropic adapter');
      return new AnthropicAdapter(
        options.model,
        options.apiKey,
        options.apiBaseUrl,
        options.timeoutMs,
      );
    case 'gemini': {
      if (!options.apiKey) throw new Error('apiKey is required for the Gemini adapter');
      const endpoint = options.apiBaseUrl ?? process.env.GEMINI_ENDPOINT ?? GEMINI_DEFAULT_ENDPOINT;
      const timeoutMs = (options.timeoutMs ?? Number(process.env.GEMINI_TIMEOUT_MS)) || GEMINI_DEFAULT_TIMEOUT_MS;
      const retryMax = Number(process.env.GEMINI_RETRY_MAX) || GEMINI_DEFAULT_RETRY_MAX;
      return new GeminiAdapter(options.model, options.apiKey, endpoint, timeoutMs, retryMax);
    }
    case 'copilot':
    default:
      return new CopilotAdapter(options.model, options.timeoutMs);
  }
}

export function resolveProvider(): ProviderType {
  const explicit = (process.env.COPILOT_PROVIDER ?? '').toLowerCase() as ProviderType;
  if (
    explicit === 'openai' ||
    explicit === 'anthropic' ||
    explicit === 'copilot' ||
    explicit === 'gemini'
  ) {
    return explicit;
  }
  // Provider-specific API keys
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  // When any BYOK API key is configured, default to openai-compatible adapter
  const byokKey = process.env.COPILOT_PROVIDER_API_KEY ?? process.env.COPILOT_API_KEY ?? '';
  if (byokKey) return 'openai';
  return 'copilot';
}
