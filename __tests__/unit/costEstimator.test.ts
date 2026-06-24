/**
 * Unit tests for lib/telemetry/costEstimator.ts
 */

import {
  getPricing,
  estimateCost,
  estimateTotalCosts,
  getTotalSpend,
} from '../../lib/telemetry/costEstimator';
import {
  recordTokenUsage,
  _resetTokenUsageForTests,
} from '../../lib/telemetry/tokenTracker';
import type { TokenUsageSummaryEntry } from '../../lib/telemetry/tokenTracker';

beforeEach(() => {
  _resetTokenUsageForTests();
  delete process.env.CUSTOM_PRICING;
});

afterEach(() => {
  delete process.env.CUSTOM_PRICING;
});

// ---------------------------------------------------------------------------
// getPricing
// ---------------------------------------------------------------------------

describe('getPricing – known models', () => {
  it('returns pricing for openai:gpt-4o', () => {
    const p = getPricing('openai', 'gpt-4o');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.0025);
    expect(p!.completionPer1kTokens).toBeCloseTo(0.01);
  });

  it('returns pricing for openai:gpt-4o-mini', () => {
    const p = getPricing('openai', 'gpt-4o-mini');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.00015);
    expect(p!.completionPer1kTokens).toBeCloseTo(0.0006);
  });

  it('returns pricing for openai:gpt-5-mini', () => {
    const p = getPricing('openai', 'gpt-5-mini');
    expect(p).toBeDefined();
  });

  it('returns pricing for anthropic:claude-sonnet-4-20250514', () => {
    const p = getPricing('anthropic', 'claude-sonnet-4-20250514');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.003);
    expect(p!.completionPer1kTokens).toBeCloseTo(0.015);
  });

  it('returns pricing for anthropic:claude-haiku', () => {
    const p = getPricing('anthropic', 'claude-haiku');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.00025);
    expect(p!.completionPer1kTokens).toBeCloseTo(0.00125);
  });

  it('returns pricing for anthropic:claude-opus-4-20250514', () => {
    const p = getPricing('anthropic', 'claude-opus-4-20250514');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.015);
    expect(p!.completionPer1kTokens).toBeCloseTo(0.075);
  });

  it('returns pricing for gemini:gemini-2.0-flash', () => {
    const p = getPricing('gemini', 'gemini-2.0-flash');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.0001);
    expect(p!.completionPer1kTokens).toBeCloseTo(0.0004);
  });
});

describe('getPricing – unknown models', () => {
  it('returns undefined for an unknown model', () => {
    expect(getPricing('openai', 'gpt-99-turbo')).toBeUndefined();
  });

  it('returns undefined for an unknown provider', () => {
    expect(getPricing('acme', 'gpt-4o')).toBeUndefined();
  });

  it('returns undefined for empty strings', () => {
    expect(getPricing('', '')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Custom pricing via CUSTOM_PRICING env var
// ---------------------------------------------------------------------------

describe('getPricing – CUSTOM_PRICING env var', () => {
  it('uses custom pricing when set', () => {
    process.env.CUSTOM_PRICING = JSON.stringify({
      'acme:my-model': { promptPer1kTokens: 0.001, completionPer1kTokens: 0.002 },
    });
    const p = getPricing('acme', 'my-model');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.001);
    expect(p!.completionPer1kTokens).toBeCloseTo(0.002);
  });

  it('custom pricing overrides built-in pricing', () => {
    process.env.CUSTOM_PRICING = JSON.stringify({
      'openai:gpt-4o': { promptPer1kTokens: 0.999, completionPer1kTokens: 9.99 },
    });
    const p = getPricing('openai', 'gpt-4o');
    expect(p!.promptPer1kTokens).toBeCloseTo(0.999);
  });

  it('returns undefined for malformed CUSTOM_PRICING JSON', () => {
    process.env.CUSTOM_PRICING = 'not-valid-json';
    // Falls back to built-in; unknown model still returns undefined
    expect(getPricing('acme', 'bad-model')).toBeUndefined();
  });

  it('falls back to built-in when model not in custom pricing', () => {
    process.env.CUSTOM_PRICING = JSON.stringify({
      'acme:my-model': { promptPer1kTokens: 0.001, completionPer1kTokens: 0.002 },
    });
    const p = getPricing('openai', 'gpt-4o');
    expect(p).toBeDefined();
    expect(p!.promptPer1kTokens).toBeCloseTo(0.0025);
  });
});

// ---------------------------------------------------------------------------
// estimateCost – cost calculation correctness
// ---------------------------------------------------------------------------

function makeEntry(
  provider: string,
  model: string,
  overrides: Partial<TokenUsageSummaryEntry> = {},
): TokenUsageSummaryEntry {
  return {
    provider,
    model,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    requestCount: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('estimateCost – correctness', () => {
  it('computes prompt cost correctly for gpt-4o', () => {
    // 1000 prompt tokens @ $0.0025/1k => $0.0025
    const entry = makeEntry('openai', 'gpt-4o', { totalPromptTokens: 1000 });
    const est = estimateCost('openai', 'gpt-4o', entry);
    expect(est.promptCost).toBeCloseTo(0.0025, 6);
    expect(est.completionCost).toBe(0);
    expect(est.cacheCost).toBe(0);
    expect(est.totalCost).toBeCloseTo(0.0025, 6);
    expect(est.currency).toBe('USD');
  });

  it('computes completion cost correctly for gpt-4o', () => {
    // 500 completion tokens @ $0.01/1k => $0.005
    const entry = makeEntry('openai', 'gpt-4o', { totalCompletionTokens: 500 });
    const est = estimateCost('openai', 'gpt-4o', entry);
    expect(est.completionCost).toBeCloseTo(0.005, 6);
  });

  it('computes both prompt and completion costs together', () => {
    // 2000 prompt @ $0.0025/1k = $0.005 + 1000 completion @ $0.01/1k = $0.01 => $0.015
    const entry = makeEntry('openai', 'gpt-4o', {
      totalPromptTokens: 2000,
      totalCompletionTokens: 1000,
    });
    const est = estimateCost('openai', 'gpt-4o', entry);
    expect(est.promptCost).toBeCloseTo(0.005, 6);
    expect(est.completionCost).toBeCloseTo(0.01, 6);
    expect(est.totalCost).toBeCloseTo(0.015, 6);
  });

  it('returns all zeros for unknown provider/model', () => {
    const entry = makeEntry('unknown', 'unknown-model', {
      totalPromptTokens: 10000,
      totalCompletionTokens: 5000,
    });
    const est = estimateCost('unknown', 'unknown-model', entry);
    expect(est.promptCost).toBe(0);
    expect(est.completionCost).toBe(0);
    expect(est.cacheCost).toBe(0);
    expect(est.totalCost).toBe(0);
    expect(est.currency).toBe('USD');
  });

  it('returns all zeros for zero token usage (known model)', () => {
    const entry = makeEntry('openai', 'gpt-4o');
    const est = estimateCost('openai', 'gpt-4o', entry);
    expect(est.promptCost).toBe(0);
    expect(est.completionCost).toBe(0);
    expect(est.cacheCost).toBe(0);
    expect(est.totalCost).toBe(0);
  });

  it('attaches correct provider and model to result', () => {
    const entry = makeEntry('anthropic', 'claude-haiku', { totalPromptTokens: 100 });
    const est = estimateCost('anthropic', 'claude-haiku', entry);
    expect(est.provider).toBe('anthropic');
    expect(est.model).toBe('claude-haiku');
  });
});

describe('estimateCost – cache token costs', () => {
  it('computes cache read cost for anthropic models', () => {
    // claude-haiku cacheReadPer1kTokens = 0.00003
    // 1000 cache read tokens => $0.00003
    const entry = makeEntry('anthropic', 'claude-haiku', { cacheReadInputTokens: 1000 });
    const est = estimateCost('anthropic', 'claude-haiku', entry);
    expect(est.cacheCost).toBeCloseTo(0.00003, 8);
    expect(est.totalCost).toBeCloseTo(0.00003, 8);
  });

  it('computes cache write cost for anthropic models', () => {
    // claude-haiku cacheWritePer1kTokens = 0.0003
    // 1000 cache write tokens => $0.0003
    const entry = makeEntry('anthropic', 'claude-haiku', { cacheCreationInputTokens: 1000 });
    const est = estimateCost('anthropic', 'claude-haiku', entry);
    expect(est.cacheCost).toBeCloseTo(0.0003, 6);
  });

  it('sums cache read and cache write costs', () => {
    // claude-haiku: cacheRead=0.00003/1k, cacheWrite=0.0003/1k
    // 2000 read => 0.00006, 1000 write => 0.0003 => cacheCost=0.00036
    const entry = makeEntry('anthropic', 'claude-haiku', {
      cacheReadInputTokens: 2000,
      cacheCreationInputTokens: 1000,
    });
    const est = estimateCost('anthropic', 'claude-haiku', entry);
    expect(est.cacheCost).toBeCloseTo(0.00036, 6);
  });

  it('produces zero cache cost for models without cache pricing (e.g. gpt-4o)', () => {
    const entry = makeEntry('openai', 'gpt-4o', {
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 5000,
    });
    const est = estimateCost('openai', 'gpt-4o', entry);
    expect(est.cacheCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// estimateTotalCosts / getTotalSpend
// ---------------------------------------------------------------------------

describe('estimateTotalCosts', () => {
  it('returns empty array when no usage has been recorded', () => {
    expect(estimateTotalCosts()).toEqual([]);
  });

  it('returns one estimate per tracked provider+model', () => {
    recordTokenUsage('openai', 'gpt-4o', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    recordTokenUsage('anthropic', 'claude-haiku', { promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 });

    const estimates = estimateTotalCosts();
    expect(estimates).toHaveLength(2);
    const providers = estimates.map((e) => e.provider);
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
  });

  it('computes correct costs for recorded usage', () => {
    // 1000 prompt @ $0.0025/1k = $0.0025; 500 completion @ $0.01/1k = $0.005 => total $0.0075
    recordTokenUsage('openai', 'gpt-4o', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });

    const estimates = estimateTotalCosts();
    expect(estimates).toHaveLength(1);
    const est = estimates[0];
    expect(est.promptCost).toBeCloseTo(0.0025, 6);
    expect(est.completionCost).toBeCloseTo(0.005, 6);
    expect(est.totalCost).toBeCloseTo(0.0075, 6);
  });

  it('unknown models produce zero cost estimates', () => {
    recordTokenUsage('mystery', 'unknown-llm', { promptTokens: 99999, completionTokens: 99999, totalTokens: 199998 });

    const estimates = estimateTotalCosts();
    expect(estimates).toHaveLength(1);
    expect(estimates[0].totalCost).toBe(0);
  });
});

describe('getTotalSpend', () => {
  it('returns zero totalUsd with empty breakdown when nothing recorded', () => {
    const result = getTotalSpend();
    expect(result.totalUsd).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it('sums all costs across providers', () => {
    // openai/gpt-4o: 1000 prompt @ $0.0025/1k = $0.0025; 500 completion @ $0.01/1k = $0.005 => $0.0075
    // anthropic/claude-haiku: 2000 prompt @ $0.00025/1k = $0.0005; 1000 completion @ $0.00125/1k = $0.00125 => $0.00175
    // total = $0.00925
    recordTokenUsage('openai', 'gpt-4o', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    recordTokenUsage('anthropic', 'claude-haiku', { promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 });

    const { totalUsd, breakdown } = getTotalSpend();
    expect(breakdown).toHaveLength(2);
    expect(totalUsd).toBeCloseTo(0.00925, 6);
  });

  it('breakdown contains CostEstimate objects with currency USD', () => {
    recordTokenUsage('openai', 'gpt-4o-mini', { promptTokens: 500, completionTokens: 200, totalTokens: 700 });
    const { breakdown } = getTotalSpend();
    expect(breakdown[0].currency).toBe('USD');
  });
});
