/**
 * Cost Estimator
 *
 * Maps provider+model to token pricing and computes estimated USD costs
 * based on accumulated token usage from the tokenTracker.
 */

import type { TokenUsageSummaryEntry } from './tokenTracker';
import { getTokenUsageSummary } from './tokenTracker';

export interface PricingTier {
  promptPer1kTokens: number;      // USD per 1K input tokens
  completionPer1kTokens: number;  // USD per 1K output tokens
  cacheReadPer1kTokens?: number;  // USD per 1K cache read tokens (optional)
  cacheWritePer1kTokens?: number; // USD per 1K cache write tokens (optional)
}

export interface CostEstimate {
  provider: string;
  model: string;
  promptCost: number;
  completionCost: number;
  cacheCost: number;
  totalCost: number;
  currency: 'USD';
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

/**
 * Compute a cost estimate for a single provider+model usage entry.
 * If no pricing is found, all costs are 0.
 */
export function estimateCost(
  provider: string,
  model: string,
  usage: TokenUsageSummaryEntry,
): CostEstimate {
  const pricing = getPricing(provider, model);

  if (!pricing) {
    return {
      provider,
      model,
      promptCost: 0,
      completionCost: 0,
      cacheCost: 0,
      totalCost: 0,
      currency: 'USD',
    };
  }

  const promptCost = (usage.totalPromptTokens / 1000) * pricing.promptPer1kTokens;
  const completionCost = (usage.totalCompletionTokens / 1000) * pricing.completionPer1kTokens;

  const cacheReadCost =
    pricing.cacheReadPer1kTokens !== undefined
      ? (usage.cacheReadInputTokens / 1000) * pricing.cacheReadPer1kTokens
      : 0;
  const cacheWriteCost =
    pricing.cacheWritePer1kTokens !== undefined
      ? (usage.cacheCreationInputTokens / 1000) * pricing.cacheWritePer1kTokens
      : 0;
  const cacheCost = cacheReadCost + cacheWriteCost;

  const totalCost = promptCost + completionCost + cacheCost;

  return { provider, model, promptCost, completionCost, cacheCost, totalCost, currency: 'USD' };
}

/**
 * Compute cost estimates for all currently tracked provider+model usage entries.
 */
export function estimateTotalCosts(): CostEstimate[] {
  return getTokenUsageSummary().map((entry) =>
    estimateCost(entry.provider, entry.model, entry),
  );
}

/**
 * Convenience wrapper that returns total spend and per-entry breakdown.
 */
export function getTotalSpend(): { totalUsd: number; breakdown: CostEstimate[] } {
  const breakdown = estimateTotalCosts();
  const totalUsd = breakdown.reduce((sum, e) => sum + e.totalCost, 0);
  return { totalUsd, breakdown };
}
