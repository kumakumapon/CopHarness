/**
 * Token Usage Tracker
 *
 * Accumulates per-provider/model token usage in a singleton in-memory store.
 * Designed to be wired into InstrumentedAdapter so every LLM call is tracked.
 */

import type { TokenUsage } from '../adapter';

export interface TokenUsageSummaryEntry {
  provider: string;
  model: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requestCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface TokenUsageRecord {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requestCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

// Singleton in-memory store keyed by "<provider>:<model>"
const store = new Map<string, TokenUsageRecord>();

/**
 * Record token usage for a given provider + model pair.
 * All numeric fields from TokenUsage are accumulated; missing fields are treated as 0.
 */
export function recordTokenUsage(provider: string, model: string, usage: TokenUsage): void {
  const key = `${provider}:${model}`;
  const now = new Date().toISOString();
  const existing = store.get(key);

  if (existing) {
    existing.totalPromptTokens += usage.promptTokens ?? 0;
    existing.totalCompletionTokens += usage.completionTokens ?? 0;
    existing.totalTokens += usage.totalTokens ?? 0;
    existing.cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0;
    existing.cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
    existing.requestCount += 1;
    existing.lastSeenAt = now;
  } else {
    store.set(key, {
      totalPromptTokens: usage.promptTokens ?? 0,
      totalCompletionTokens: usage.completionTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
      requestCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }
}

/**
 * Return a snapshot of all tracked provider/model pairs, sorted by totalTokens descending.
 */
export function getTokenUsageSummary(): TokenUsageSummaryEntry[] {
  const entries: TokenUsageSummaryEntry[] = [];

  for (const [key, record] of store.entries()) {
    const colonIndex = key.indexOf(':');
    const provider = key.slice(0, colonIndex);
    const model = key.slice(colonIndex + 1);
    entries.push({ provider, model, ...record });
  }

  entries.sort((a, b) => b.totalTokens - a.totalTokens);
  return entries;
}

/**
 * Reset all accumulated token usage data. Intended for use in tests only.
 */
export function _resetTokenUsageForTests(): void {
  store.clear();
}
