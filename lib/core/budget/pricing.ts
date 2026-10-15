export interface PricingTier {
  promptPer1kTokens: number;      // USD per 1K input tokens
  completionPer1kTokens: number;  // USD per 1K output tokens
  cacheReadPer1kTokens?: number;  // USD per 1K cache read tokens (optional)
  cacheWritePer1kTokens?: number; // USD per 1K cache write tokens (optional)
}

// Built-in pricing table keyed by "provider:model"
// All prices are USD per 1K tokens (i.e., per-million-token price / 1000)
const BUILT_IN_PRICING = new Map<string, PricingTier>([
  // OpenAI
  ['openai:gpt-4o',       { promptPer1kTokens: 0.0025, completionPer1kTokens: 0.01 }],
  ['openai:gpt-4o-mini',  { promptPer1kTokens: 0.00015, completionPer1kTokens: 0.0006 }],
  ['openai:gpt-5-mini',   { promptPer1kTokens: 0.00015, completionPer1kTokens: 0.0006 }],
  // Anthropic
  ['anthropic:claude-sonnet-4-20250514', { promptPer1kTokens: 0.003, completionPer1kTokens: 0.015, cacheReadPer1kTokens: 0.0003, cacheWritePer1kTokens: 0.00375 }],
  ['anthropic:claude-haiku',             { promptPer1kTokens: 0.00025, completionPer1kTokens: 0.00125, cacheReadPer1kTokens: 0.00003, cacheWritePer1kTokens: 0.0003 }],
  ['anthropic:claude-opus-4-20250514',   { promptPer1kTokens: 0.015, completionPer1kTokens: 0.075, cacheReadPer1kTokens: 0.0015, cacheWritePer1kTokens: 0.01875 }],
  // Gemini
  ['gemini:gemini-2.0-flash', { promptPer1kTokens: 0.0001, completionPer1kTokens: 0.0004 }],
]);

/**
 * Parse custom pricing from the CUSTOM_PRICING environment variable.
 * Expected format: JSON object mapping "provider:model" to PricingTier.
 * Returns an empty map if the env var is unset or invalid.
 */
function parseCustomPricing(): Map<string, PricingTier> {
  const raw = process.env.CUSTOM_PRICING;
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, PricingTier>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

/**
 * Look up pricing for a given provider + model.
 * Custom pricing (via CUSTOM_PRICING env var) takes precedence over built-in pricing.
 * Returns undefined if no pricing is available for the combination.
 */
export function getPricing(provider: string, model: string): PricingTier | undefined {
  const key = `${provider}:${model}`;
  const custom = parseCustomPricing();
  if (custom.has(key)) return custom.get(key);
  return BUILT_IN_PRICING.get(key);
}
