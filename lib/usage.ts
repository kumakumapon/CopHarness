/**
 * Token usage, cost estimates and daily limits.
 * Prices are USD per million tokens. Unknown models have no cost estimate;
 * add them under `pricing` in copharness.json ("provider/model" or "model").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config, Pricing } from './config';
import { addUsage, emptyUsage, type Usage } from './types';
import { atomicWriteJson, withFileLock } from './util/jsonFile';

const BUILTIN_PRICING: Record<string, Pricing> = {
  // Anthropic (first-party API list prices)
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // OpenAI / Google (reference list prices; override in copharness.json if they change)
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.31 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.075 },
};

export function findPricing(modelRef: string, overrides: Record<string, Pricing> = {}): Pricing | undefined {
  const model = modelRef.includes('/') ? modelRef.slice(modelRef.indexOf('/') + 1) : modelRef;
  const provider = modelRef.includes('/') ? modelRef.slice(0, modelRef.indexOf('/')) : '';
  // Local servers are free; Copilot is billed by subscription.
  if (['lmstudio', 'lemonade', 'ollama', 'copilot'].includes(provider)) return { input: 0, output: 0 };
  return overrides[modelRef] ?? overrides[model] ?? BUILTIN_PRICING[model];
}

export function estimateCost(modelRef: string, usage: Usage, overrides?: Record<string, Pricing>): number | undefined {
  const p = findPricing(modelRef, overrides);
  if (!p) return undefined;
  return (
    usage.inputTokens * p.input
    + usage.outputTokens * p.output
    + usage.cacheReadTokens * (p.cacheRead ?? p.input)
    + usage.cacheWriteTokens * (p.cacheWrite ?? p.input)
  ) / 1_000_000;
}

export const totalTokens = (u: Usage) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

interface DayUsage { usage: Usage; costUsd: number; byModel: Record<string, { usage: Usage; costUsd: number }> }
interface UsageFile { days: Record<string, DayUsage> }

const today = () => new Date().toISOString().slice(0, 10);

/** Daily totals in `<dataDir>/usage.json`, shared by every process using the same data directory. */
export class UsageStore {
  private readonly file: string;

  constructor(dataDir: string, private readonly pricing: Record<string, Pricing> = {}) {
    this.file = path.join(dataDir, 'usage.json');
  }

  private read(): UsageFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as UsageFile;
      return parsed && typeof parsed.days === 'object' ? parsed : { days: {} };
    } catch {
      return { days: {} };
    }
  }

  async record(modelRef: string, usage: Usage): Promise<number | undefined> {
    const cost = estimateCost(modelRef, usage, this.pricing);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    await withFileLock(this.file, async () => {
      const data = this.read();
      const day = (data.days[today()] ??= { usage: emptyUsage(), costUsd: 0, byModel: {} });
      day.usage = addUsage(day.usage, usage);
      day.costUsd += cost ?? 0;
      const m = (day.byModel[modelRef] ??= { usage: emptyUsage(), costUsd: 0 });
      m.usage = addUsage(m.usage, usage);
      m.costUsd += cost ?? 0;
      // Keep 90 days.
      for (const key of Object.keys(data.days).sort().slice(0, -90)) delete data.days[key];
      await atomicWriteJson(this.file, data);
    });
    return cost;
  }

  today(): DayUsage {
    return this.read().days[today()] ?? { usage: emptyUsage(), costUsd: 0, byModel: {} };
  }

  /** Reason the next model call must not run, if a daily limit is reached. */
  limitReached(limits: Config['limits']): string | undefined {
    const day = this.today();
    if (limits.dailyCostUsd !== undefined && day.costUsd >= limits.dailyCostUsd) {
      return `本日の費用上限（$${limits.dailyCostUsd}）に達しました（使用済み $${day.costUsd.toFixed(4)}）。`;
    }
    if (limits.dailyTokens !== undefined && totalTokens(day.usage) >= limits.dailyTokens) {
      return `本日のトークン上限（${limits.dailyTokens.toLocaleString()}）に達しました。`;
    }
    return undefined;
  }
}
