/**
 * Cost Estimator
 *
 * Maps provider+model to token pricing and computes estimated USD costs
 * based on accumulated token usage from the tokenTracker.
 */

import type { TokenUsageSummaryEntry } from './tokenTracker';
import { getTokenUsageSummary } from './tokenTracker';

import { getPricing } from '../../core/budget/pricing';
export { getPricing } from '../../core/budget/pricing';
export type { PricingTier } from '../../core/budget/pricing';

export interface CostEstimate {
  provider: string;
  model: string;
  promptCost: number;
  completionCost: number;
  cacheCost: number;
  totalCost: number;
  currency: 'USD';
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
