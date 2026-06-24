import { type LLMAdapter, type AdapterOptions, type ProviderType } from './adapter';
import { CopilotAdapter } from './adapters/copilotAdapter';
import { OpenAIAdapter } from './adapters/openaiAdapter';
import { AnthropicAdapter } from './adapters/anthropicAdapter';
import { LmStudioAdapter } from './adapters/lmstudioAdapter';
import { LemonadeAdapter } from './adapters/lemonadeAdapter';
import { AntigravityAdapter } from './adapters/antigravityAdapter';
import { FallbackAdapter } from './adapters/fallbackAdapter';
import { RetryAdapter } from './adapters/retryAdapter';
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
    case 'antigravity': {
      const antigravityKey = options.apiKey || process.env.GEMINI_API_KEY;
      if (!antigravityKey) throw new Error('apiKey is required for the Antigravity adapter');
      return wrapAdapter(new AntigravityAdapter(
        options.model,
        antigravityKey,
        options.timeoutMs,
      ));
    }
    case 'copilot':
    default:
      return wrapAdapter(new CopilotAdapter(options.model, options.timeoutMs));
  }
}

function wrapAdapter(adapter: LLMAdapter): LLMAdapter {
  // Each attempt is individually instrumented before retry wraps it, so
  // telemetry reflects per-attempt behaviour rather than only the final success.
  let wrapped: LLMAdapter = new InstrumentedAdapter(adapter);
  wrapped = new RetryAdapter(wrapped);
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
    case 'antigravity': return process.env.ANTIGRAVITY_MODEL || 'gemini-2.0-flash';
    default:          return 'gpt-5-mini';
  }
}

/**
 * Resolve the API key for a provider from environment variables.
 * Returns undefined when no key is available (e.g. local-only providers).
 */
export function resolveApiKey(provider: ProviderType): string | undefined {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY ?? process.env.COPILOT_PROVIDER_API_KEY ?? process.env.COPILOT_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'antigravity':
      return process.env.ANTIGRAVITY_API_KEY ?? process.env.GEMINI_API_KEY;
    default:
      return undefined;
  }
}

/**
 * Creates an adapter with automatic fallback to alternative providers.
 *
 * Set FALLBACK_PROVIDERS as a comma-separated list of provider names
 * (e.g. "openai,anthropic,antigravity"). When the primary provider
 * fails with a retryable error, the next provider in the list is tried.
 *
 * If FALLBACK_PROVIDERS is not set, behaves identically to createAdapter.
 */
export function createAdapterWithFallback(options: AdapterOptions): LLMAdapter {
  const fallbackEnv = process.env.FALLBACK_PROVIDERS;
  if (!fallbackEnv || !fallbackEnv.trim()) {
    return createAdapter(options);
  }

  const fallbackProviders = fallbackEnv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderType =>
      ['openai', 'anthropic', 'copilot', 'lmstudio', 'lemonade', 'antigravity'].includes(s),
    )
    .filter((p) => p !== options.provider);

  if (fallbackProviders.length === 0) {
    return createAdapter(options);
  }

  const adapters: LLMAdapter[] = [createAdapter(options)];
  for (const provider of fallbackProviders) {
    try {
      const key = resolveApiKey(provider);
      const model = resolveModel(provider);
      adapters.push(createAdapter({ provider, model, apiKey: key, timeoutMs: options.timeoutMs }));
    } catch {
      // Skip providers that can't be constructed (e.g. missing API key)
    }
  }

  if (adapters.length <= 1) {
    return adapters[0];
  }

  return wrapAdapter(new FallbackAdapter(adapters));
}

export function resolveProvider(): ProviderType {
  const explicit = (process.env.COPILOT_PROVIDER ?? '').toLowerCase() as ProviderType;
  if (
    explicit === 'openai' ||
    explicit === 'anthropic' ||
    explicit === 'copilot' ||
    explicit === 'lmstudio' ||
    explicit === 'lemonade' ||
    explicit === 'antigravity'
  ) {
    return explicit;
  }
  // Provider-specific API keys
  if (process.env.GEMINI_API_KEY) return 'antigravity';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTIGRAVITY_API_KEY) return 'antigravity';
  // Local LLM servers detected by their endpoint env vars
  if (process.env.LMSTUDIO_BASE_URL) return 'lmstudio';
  if (process.env.LEMONADE_BASE_URL) return 'lemonade';
  // When any BYOK API key is configured, default to openai-compatible adapter
  const byokKey = process.env.COPILOT_PROVIDER_API_KEY ?? process.env.COPILOT_API_KEY ?? '';
  if (byokKey) return 'openai';
  return 'copilot';
}
