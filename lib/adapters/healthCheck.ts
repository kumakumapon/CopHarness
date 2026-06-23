/**
 * Adapter health check module.
 * Pings each configured LLM adapter with a minimal request to verify it responds.
 */

import { type LLMAdapter, type ProviderType } from '../adapter';
import {
  createAdapter,
  resolveApiKey,
  resolveModel,
} from '../adapterFactory';

export interface HealthCheckResult {
  provider: string;
  model: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export interface HealthCheckOptions {
  /** Request timeout in milliseconds. Default: 10000 */
  timeoutMs?: number;
  /** Specific providers to check. Default: all configured providers */
  providers?: ProviderType[];
}

/**
 * Determines which providers are currently configured based on environment variables.
 */
function getConfiguredProviders(): ProviderType[] {
  const configured: ProviderType[] = [];

  // copilot is always available (uses SDK, no key required)
  configured.push('copilot');

  if (process.env.OPENAI_API_KEY || process.env.COPILOT_PROVIDER_API_KEY || process.env.COPILOT_API_KEY) {
    configured.push('openai');
  }
  if (process.env.ANTHROPIC_API_KEY) {
    configured.push('anthropic');
  }
  if (process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_API_KEY) {
    configured.push('antigravity');
  }
  if (process.env.LMSTUDIO_BASE_URL) {
    configured.push('lmstudio');
  }
  if (process.env.LEMONADE_BASE_URL) {
    configured.push('lemonade');
  }

  return configured;
}

/**
 * Sends a minimal request to a single adapter and returns a health check result.
 * Never throws — errors are captured in the result.
 */
export async function checkAdapterHealth(
  adapter: LLMAdapter,
  timeoutMs = 10000,
): Promise<HealthCheckResult> {
  const checkedAt = new Date().toISOString();
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await adapter.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        timeoutMs,
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    return {
      provider: adapter.provider,
      model: adapter.model,
      healthy: true,
      latencyMs: Date.now() - start,
      checkedAt,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      provider: adapter.provider,
      model: adapter.model,
      healthy: false,
      latencyMs: Date.now() - start,
      error,
      checkedAt,
    };
  }
}

/**
 * Checks all configured (or specified) providers in parallel.
 * Each provider gets a temporary adapter that is destroyed after the check.
 */
export async function checkAllProviders(
  options: HealthCheckOptions = {},
): Promise<HealthCheckResult[]> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const providersToCheck = options.providers ?? getConfiguredProviders();

  const checks = providersToCheck.map(async (provider): Promise<HealthCheckResult> => {
    const checkedAt = new Date().toISOString();
    let adapter: LLMAdapter | undefined;

    try {
      const model = resolveModel(provider);
      const apiKey = resolveApiKey(provider);
      const apiBaseUrl =
        provider === 'lmstudio'
          ? process.env.LMSTUDIO_BASE_URL
          : provider === 'lemonade'
            ? process.env.LEMONADE_BASE_URL
            : undefined;

      adapter = createAdapter({ provider, model, apiKey, apiBaseUrl, timeoutMs });
      const result = await checkAdapterHealth(adapter, timeoutMs);
      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        provider,
        model: resolveModel(provider),
        healthy: false,
        latencyMs: 0,
        error,
        checkedAt,
      };
    } finally {
      if (adapter?.destroy) {
        try {
          await adapter.destroy();
        } catch {
          // ignore cleanup errors
        }
      }
    }
  });

  return Promise.all(checks);
}
