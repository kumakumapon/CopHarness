import { PROVIDER_PRESETS, normalizeProviderName, parseModelRef, type Config, type ProviderConfig } from '../config';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAIProvider } from './openai';
import { withRetry, type ModelProvider } from './types';

export type { ModelProvider, ModelRequest, ModelResult, ModelEvent } from './types';

type Env = Record<string, string | undefined>;

export interface ResolvedProvider {
  /** Name as written in the model reference ("lmstudio", "anthropic", ...). */
  name: string;
  type: ProviderConfig['type'];
  model: string;
  baseUrl?: string;
  apiKey?: string;
  /** False when a required credential is missing. */
  configured: boolean;
  missing?: string;
}

function keyFor(type: ProviderConfig['type'], env: Env): string | undefined {
  switch (type) {
    case 'anthropic': return env.ANTHROPIC_API_KEY;
    case 'openai': return env.OPENAI_API_KEY || env.COPILOT_PROVIDER_API_KEY || env.COPILOT_API_KEY;
    case 'gemini': return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.ANTIGRAVITY_API_KEY;
    default: return undefined;
  }
}

const KEY_HINT: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

/** Work out which provider, endpoint and credential a model reference uses. */
export function resolveProvider(modelRef: string, config: Pick<Config, 'providers'>, env: Env = process.env): ResolvedProvider {
  const { provider, model } = parseModelRef(modelRef, env);
  const name = normalizeProviderName(provider);
  const custom = config.providers[name];
  const preset = PROVIDER_PRESETS[name];
  if (custom || preset) {
    const base = { ...preset, ...custom } as ProviderConfig & { baseUrlEnv?: string; keyOptional?: boolean };
    const keyEnv = base.apiKeyEnv;
    const apiKey = base.apiKey || (keyEnv ? env[keyEnv] : undefined);
    const baseUrl = (preset?.baseUrlEnv && env[preset.baseUrlEnv]) || base.baseUrl;
    const keyOptional = Boolean(preset?.keyOptional) || (Boolean(custom) && !keyEnv && !base.apiKey) || base.type === 'copilot';
    const configured = keyOptional || Boolean(apiKey);
    return { name, type: base.type, model, baseUrl, apiKey, configured, missing: configured ? undefined : keyEnv };
  }
  if (!['anthropic', 'openai', 'gemini', 'copilot'].includes(name)) {
    return { name, type: 'openai', model, configured: false, missing: `providers.${name}（copharness.json）` };
  }
  const type = name as ProviderConfig['type'];
  const apiKey = keyFor(type, env);
  const baseUrl = { openai: env.OPENAI_BASE_URL, anthropic: env.ANTHROPIC_BASE_URL, gemini: env.GEMINI_BASE_URL, copilot: undefined }[type] || undefined;
  const configured = type === 'copilot' || Boolean(apiKey);
  return { name, type, model, apiKey, baseUrl, configured, missing: configured ? undefined : KEY_HINT[type] };
}

export function createProvider(resolved: ResolvedProvider, config: Pick<Config, 'requestTimeoutMs' | 'maxOutputTokens' | 'effort'>): ModelProvider {
  if (!resolved.configured) {
    throw new Error(`${resolved.name} の認証情報がありません。${resolved.missing ?? 'API キー'} を .env.local に設定してください（npm run doctor で確認できます）。`);
  }
  const timeoutMs = config.requestTimeoutMs;
  switch (resolved.type) {
    case 'anthropic':
      return withRetry(new AnthropicProvider({ apiKey: resolved.apiKey, baseUrl: resolved.baseUrl, timeoutMs, maxOutputTokens: config.maxOutputTokens, effort: config.effort }));
    case 'openai':
      return withRetry(new OpenAIProvider({ apiKey: resolved.apiKey, baseUrl: resolved.baseUrl, timeoutMs, maxOutputTokens: config.maxOutputTokens }));
    case 'gemini':
      return withRetry(new GeminiProvider({ apiKey: resolved.apiKey!, baseUrl: resolved.baseUrl, timeoutMs, maxOutputTokens: config.maxOutputTokens }));
    case 'copilot': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CopilotProvider } = require('./copilot') as typeof import('./copilot');
      return new CopilotProvider({ timeoutMs });
    }
  }
}

/** Providers that are usable with the current environment (for status screens and /model). */
export function listProviderStatus(config: Pick<Config, 'providers'>, env: Env = process.env) {
  const names = ['anthropic', 'openai', 'gemini', 'copilot', ...Object.keys(PROVIDER_PRESETS), ...Object.keys(config.providers)];
  return [...new Set(names)].map(name => {
    const r = resolveProvider(`${name}/x`, config, env);
    return { name, type: r.type, configured: r.configured, baseUrl: r.baseUrl, missing: r.missing };
  });
}
