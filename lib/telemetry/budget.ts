import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TokenUsage } from '../adapter';
import { dataPath } from '../utils/dataDir';
import { getPricing } from './costEstimator';

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

interface Usage {
  tokens: number;
  costUsd: number;
}

const usage = new Map<string, Usage>();
let loadedDay: string | undefined;

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function limit(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function scopeKey(scope: string, id?: string): string | undefined {
  return id ? `${dayKey()}:${scope}:${id}` : undefined;
}

function usageFile(): string {
  return dataPath('budget-usage.json');
}

function ensureLoaded(): void {
  const today = dayKey();
  if (loadedDay === today) return;
  usage.clear();
  loadedDay = today;
  try {
    const parsed = JSON.parse(fs.readFileSync(usageFile(), 'utf8')) as { day?: string; usage?: Record<string, Usage> };
    if (parsed.day !== today || !parsed.usage) return;
    for (const [key, value] of Object.entries(parsed.usage)) {
      if (Number.isFinite(value.tokens) && Number.isFinite(value.costUsd)) usage.set(key, value);
    }
  } catch {
    // A missing or malformed historical file starts a new daily budget period.
  }
}

function persist(): void {
  ensureLoaded();
  fs.mkdirSync(path.dirname(usageFile()), { recursive: true });
  fs.writeFileSync(usageFile(), JSON.stringify({ day: loadedDay, usage: Object.fromEntries(usage) }, null, 2), 'utf8');
}

function getUsage(key: string): Usage {
  ensureLoaded();
  return usage.get(key) ?? { tokens: 0, costUsd: 0 };
}

function check(key: string | undefined, tokenLimit: number | undefined, costLimit: number | undefined, label: string): void {
  if (!key) return;
  const current = getUsage(key);
  if (tokenLimit !== undefined && current.tokens >= tokenLimit) {
    throw new BudgetExceededError(`${label} token budget has been exhausted`);
  }
  if (costLimit !== undefined && current.costUsd >= costLimit) {
    throw new BudgetExceededError(`${label} cost budget has been exhausted`);
  }
}

export interface BudgetContext {
  personId?: string;
  taskId?: string;
}

/** Blocks an LLM call once an applicable daily, user, or task budget is exhausted. */
export function assertBudgetAvailable(context: BudgetContext = {}): void {
  const day = dayKey();
  check(`${day}:global`, limit('BUDGET_MAX_TOKENS'), limit('BUDGET_MAX_COST_USD'), 'global daily');
  check(scopeKey('person', context.personId), limit('BUDGET_USER_MAX_TOKENS'), limit('BUDGET_USER_MAX_COST_USD'), 'user daily');
  check(scopeKey('task', context.taskId), limit('BUDGET_TASK_MAX_TOKENS'), limit('BUDGET_TASK_MAX_COST_USD'), 'task');
}

function usageCost(provider: string, model: string, tokens: TokenUsage): number {
  const pricing = getPricing(provider, model);
  if (!pricing) return 0;
  const prompt = (tokens.promptTokens ?? 0) / 1000 * pricing.promptPer1kTokens;
  const completion = (tokens.completionTokens ?? 0) / 1000 * pricing.completionPer1kTokens;
  const cacheRead = pricing.cacheReadPer1kTokens ? (tokens.cacheReadInputTokens ?? 0) / 1000 * pricing.cacheReadPer1kTokens : 0;
  const cacheWrite = pricing.cacheWritePer1kTokens ? (tokens.cacheCreationInputTokens ?? 0) / 1000 * pricing.cacheWritePer1kTokens : 0;
  return prompt + completion + cacheRead + cacheWrite;
}

function add(key: string | undefined, entry: Usage): void {
  if (!key) return;
  const current = getUsage(key);
  usage.set(key, { tokens: current.tokens + entry.tokens, costUsd: current.costUsd + entry.costUsd });
  persist();
}

/** Attributes post-request usage to every budget scope. */
export function recordBudgetUsage(provider: string, model: string, tokens: TokenUsage, context: BudgetContext = {}): void {
  const entry = { tokens: tokens.totalTokens ?? (tokens.promptTokens ?? 0) + (tokens.completionTokens ?? 0), costUsd: usageCost(provider, model, tokens) };
  const day = dayKey();
  add(`${day}:global`, entry);
  add(scopeKey('person', context.personId), entry);
  add(scopeKey('task', context.taskId), entry);
}

export function getBudgetSummary(): { global: Usage; limits: Record<string, number | undefined> } {
  return {
    global: getUsage(`${dayKey()}:global`),
    limits: {
      maxTokens: limit('BUDGET_MAX_TOKENS'),
      maxCostUsd: limit('BUDGET_MAX_COST_USD'),
      userMaxTokens: limit('BUDGET_USER_MAX_TOKENS'),
      userMaxCostUsd: limit('BUDGET_USER_MAX_COST_USD'),
      taskMaxTokens: limit('BUDGET_TASK_MAX_TOKENS'),
      taskMaxCostUsd: limit('BUDGET_TASK_MAX_COST_USD'),
    },
  };
}

export function getBudgetUsageForTests(key: string): Usage | undefined {
  return usage.get(key);
}

export function _resetBudgetsForTests(): void {
  usage.clear();
  loadedDay = dayKey();
}
