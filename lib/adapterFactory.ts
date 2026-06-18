import { type LLMAdapter, type AdapterOptions, type ProviderType } from './adapter';
import { CopilotAdapter } from './adapters/copilotAdapter';
import { OpenAIAdapter } from './adapters/openaiAdapter';
import { AnthropicAdapter } from './adapters/anthropicAdapter';
import { LmStudioAdapter } from './adapters/lmstudioAdapter';
import { LemonadeAdapter } from './adapters/lemonadeAdapter';
import { InstrumentedAdapter } from './telemetry/instrumentedAdapter';
import { CachedAdapter } from './cache/cachedAdapter';
import { isCacheEnabled } from './cache/responseCache';

/**
 * Creates the appropriate LLM adapter based on the given options.
 * Falls back to the Copilot SDK when no explicit provider is configured.
 */
export function createAdapter(options: AdapterOptions): LLMAdapter {
  switch (options.provider) {
    case 'openai':
      if (!options.apiKey) throw new Error('apiKey is required for the OpenAI adapter');
      return wrapAdapter(new OpenAIAdapter(
        options.model,
        options.apiKey,
        options.apiBaseUrl,
        options.timeoutMs,
      ));
    case 'anthropic':
      if (!options.apiKey) throw new Error('apiKey is required for the Anthropic adapter');
      return wrapAdapter(new AnthropicAdapter(
        options.model,
        options.apiKey,
        options.apiBaseUrl,
        options.timeoutMs,
      ));
    case 'lmstudio':
      return wrapAdapter(new LmStudioAdapter(options.model, options.apiBaseUrl, options.timeoutMs));
    case 'lemonade':
      return wrapAdapter(new LemonadeAdapter(options.model, options.apiBaseUrl, options.timeoutMs));
    case 'copilot':
    default:
      return wrapAdapter(new CopilotAdapter(options.model, options.timeoutMs));
  }
}

function wrapAdapter(adapter: LLMAdapter): LLMAdapter {
  let wrapped: LLMAdapter = adapter;
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    wrapped = new InstrumentedAdapter(wrapped);
  }
  if (isCacheEnabled()) {
    wrapped = new CachedAdapter(wrapped);
  }
  return wrapped;
}

/**
 * Resolves the model name using provider-specific env vars.
 * COPILOT_MODEL always takes precedence when set; otherwise the
 * provider-specific variable (e.g. LEMONADE_MODEL) is used.
 */
export function resolveModel(provider?: ProviderType): string {
  if (process.env.COPILOT_MODEL) return process.env.COPILOT_MODEL;
  switch (provider) {
    case 'lemonade':  return process.env.LEMONADE_MODEL  || 'gpt-5-mini';
    case 'lmstudio':  return process.env.LMSTUDIO_MODEL  || 'gpt-5-mini';
    case 'openai':    return process.env.OPENAI_MODEL    || 'gpt-5-mini';
    case 'anthropic': return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
    default:          return 'gpt-5-mini';
  }
}

export function resolveProvider(): ProviderType {
  const explicit = (process.env.COPILOT_PROVIDER ?? '').toLowerCase() as ProviderType;
  if (
    explicit === 'openai' ||
    explicit === 'anthropic' ||
    explicit === 'copilot' ||
    explicit === 'lmstudio' ||
    explicit === 'lemonade'
  ) {
    return explicit;
  }
  // Provider-specific API keys
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  // Local LLM servers detected by their endpoint env vars
  if (process.env.LMSTUDIO_BASE_URL) return 'lmstudio';
  if (process.env.LEMONADE_BASE_URL) return 'lemonade';
  // When any BYOK API key is configured, default to openai-compatible adapter
  const byokKey = process.env.COPILOT_PROVIDER_API_KEY ?? process.env.COPILOT_API_KEY ?? '';
  if (byokKey) return 'openai';
  return 'copilot';
}
