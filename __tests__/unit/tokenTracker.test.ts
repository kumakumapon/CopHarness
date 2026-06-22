/**
 * Unit tests for lib/telemetry/tokenTracker.ts
 *
 * Verifies that token usage accumulates correctly per provider/model pair,
 * multiple providers are tracked independently, the reset helper clears state,
 * the summary is sorted by totalTokens descending, and cache token fields accumulate.
 */

import {
  recordTokenUsage,
  getTokenUsageSummary,
  _resetTokenUsageForTests,
} from '../../lib/telemetry/tokenTracker';
import type { TokenUsage } from '../../lib/adapter';

beforeEach(() => {
  _resetTokenUsageForTests();
});

describe('recordTokenUsage – accumulation', () => {
  it('records initial usage correctly', () => {
    const usage: TokenUsage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
    recordTokenUsage('openai', 'gpt-4', usage);

    const summary = getTokenUsageSummary();
    expect(summary).toHaveLength(1);
    const entry = summary[0];
    expect(entry.provider).toBe('openai');
    expect(entry.model).toBe('gpt-4');
    expect(entry.totalPromptTokens).toBe(10);
    expect(entry.totalCompletionTokens).toBe(20);
    expect(entry.totalTokens).toBe(30);
    expect(entry.requestCount).toBe(1);
  });

  it('accumulates usage across multiple calls for the same provider+model', () => {
    recordTokenUsage('openai', 'gpt-4', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    recordTokenUsage('openai', 'gpt-4', { promptTokens: 5, completionTokens: 15, totalTokens: 20 });

    const summary = getTokenUsageSummary();
    expect(summary).toHaveLength(1);
    const entry = summary[0];
    expect(entry.totalPromptTokens).toBe(15);
    expect(entry.totalCompletionTokens).toBe(35);
    expect(entry.totalTokens).toBe(50);
    expect(entry.requestCount).toBe(2);
  });

  it('handles missing usage fields by treating them as 0', () => {
    recordTokenUsage('anthropic', 'claude-3', { promptTokens: 100 });
    recordTokenUsage('anthropic', 'claude-3', { completionTokens: 50 });

    const summary = getTokenUsageSummary();
    const entry = summary[0];
    expect(entry.totalPromptTokens).toBe(100);
    expect(entry.totalCompletionTokens).toBe(50);
    expect(entry.totalTokens).toBe(0);
    expect(entry.requestCount).toBe(2);
  });
});

describe('recordTokenUsage – multiple providers', () => {
  it('tracks different provider+model pairs independently', () => {
    recordTokenUsage('openai', 'gpt-4', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    recordTokenUsage('anthropic', 'claude-3', { promptTokens: 200, completionTokens: 100, totalTokens: 300 });
    recordTokenUsage('openai', 'gpt-3.5', { promptTokens: 50, completionTokens: 25, totalTokens: 75 });

    const summary = getTokenUsageSummary();
    expect(summary).toHaveLength(3);

    const openai4 = summary.find((e) => e.provider === 'openai' && e.model === 'gpt-4');
    expect(openai4).toBeDefined();
    expect(openai4!.totalTokens).toBe(150);

    const claude = summary.find((e) => e.provider === 'anthropic');
    expect(claude).toBeDefined();
    expect(claude!.totalTokens).toBe(300);

    const openai35 = summary.find((e) => e.model === 'gpt-3.5');
    expect(openai35).toBeDefined();
    expect(openai35!.totalTokens).toBe(75);
  });

  it('same model name under different providers are tracked separately', () => {
    recordTokenUsage('providerA', 'shared-model', { totalTokens: 100 });
    recordTokenUsage('providerB', 'shared-model', { totalTokens: 200 });

    const summary = getTokenUsageSummary();
    expect(summary).toHaveLength(2);
    const a = summary.find((e) => e.provider === 'providerA');
    const b = summary.find((e) => e.provider === 'providerB');
    expect(a!.totalTokens).toBe(100);
    expect(b!.totalTokens).toBe(200);
  });
});

describe('_resetTokenUsageForTests', () => {
  it('clears all accumulated data', () => {
    recordTokenUsage('openai', 'gpt-4', { totalTokens: 100 });
    expect(getTokenUsageSummary()).toHaveLength(1);

    _resetTokenUsageForTests();

    expect(getTokenUsageSummary()).toHaveLength(0);
  });

  it('allows fresh recording after reset', () => {
    recordTokenUsage('openai', 'gpt-4', { totalTokens: 999 });
    _resetTokenUsageForTests();
    recordTokenUsage('openai', 'gpt-4', { totalTokens: 5 });

    const summary = getTokenUsageSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].totalTokens).toBe(5);
    expect(summary[0].requestCount).toBe(1);
  });
});

describe('getTokenUsageSummary – sorting', () => {
  it('returns entries sorted by totalTokens descending', () => {
    recordTokenUsage('openai', 'gpt-4', { totalTokens: 50 });
    recordTokenUsage('anthropic', 'claude-3', { totalTokens: 300 });
    recordTokenUsage('openai', 'gpt-3.5', { totalTokens: 150 });

    const summary = getTokenUsageSummary();
    expect(summary[0].totalTokens).toBe(300);
    expect(summary[1].totalTokens).toBe(150);
    expect(summary[2].totalTokens).toBe(50);
  });

  it('returns empty array when no usage has been recorded', () => {
    expect(getTokenUsageSummary()).toEqual([]);
  });
});

describe('recordTokenUsage – cache token fields', () => {
  it('accumulates cacheCreationInputTokens correctly', () => {
    recordTokenUsage('anthropic', 'claude-3', { cacheCreationInputTokens: 500 });
    recordTokenUsage('anthropic', 'claude-3', { cacheCreationInputTokens: 250 });

    const summary = getTokenUsageSummary();
    expect(summary[0].cacheCreationInputTokens).toBe(750);
  });

  it('accumulates cacheReadInputTokens correctly', () => {
    recordTokenUsage('anthropic', 'claude-3', { cacheReadInputTokens: 100 });
    recordTokenUsage('anthropic', 'claude-3', { cacheReadInputTokens: 200 });

    const summary = getTokenUsageSummary();
    expect(summary[0].cacheReadInputTokens).toBe(300);
  });

  it('accumulates both cache fields alongside regular token counts', () => {
    recordTokenUsage('anthropic', 'claude-3', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheCreationInputTokens: 800,
      cacheReadInputTokens: 200,
    });
    recordTokenUsage('anthropic', 'claude-3', {
      promptTokens: 500,
      completionTokens: 250,
      totalTokens: 750,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 600,
    });

    const summary = getTokenUsageSummary();
    const entry = summary[0];
    expect(entry.totalPromptTokens).toBe(1500);
    expect(entry.totalCompletionTokens).toBe(750);
    expect(entry.totalTokens).toBe(2250);
    expect(entry.cacheCreationInputTokens).toBe(800);
    expect(entry.cacheReadInputTokens).toBe(800);
    expect(entry.requestCount).toBe(2);
  });

  it('defaults cache fields to 0 when not provided', () => {
    recordTokenUsage('openai', 'gpt-4', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });

    const summary = getTokenUsageSummary();
    expect(summary[0].cacheCreationInputTokens).toBe(0);
    expect(summary[0].cacheReadInputTokens).toBe(0);
  });
});

describe('getTokenUsageSummary – timestamps', () => {
  it('sets firstSeenAt and lastSeenAt on initial record', () => {
    const before = new Date().toISOString();
    recordTokenUsage('openai', 'gpt-4', { totalTokens: 10 });
    const after = new Date().toISOString();

    const entry = getTokenUsageSummary()[0];
    expect(entry.firstSeenAt >= before).toBe(true);
    expect(entry.firstSeenAt <= after).toBe(true);
    expect(entry.firstSeenAt).toBe(entry.lastSeenAt);
  });

  it('updates lastSeenAt but not firstSeenAt on subsequent calls', async () => {
    recordTokenUsage('openai', 'gpt-4', { totalTokens: 10 });
    const firstEntry = getTokenUsageSummary()[0];
    const firstSeenAt = firstEntry.firstSeenAt;

    // Small delay to ensure timestamps differ
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    recordTokenUsage('openai', 'gpt-4', { totalTokens: 20 });

    const updatedEntry = getTokenUsageSummary()[0];
    expect(updatedEntry.firstSeenAt).toBe(firstSeenAt);
    expect(updatedEntry.lastSeenAt >= firstSeenAt).toBe(true);
  });
});
