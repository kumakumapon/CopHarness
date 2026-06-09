import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillDefinition, SkillRiskLevel } from '../skill';
import { getSkillExecutionContext } from '../skills/executionContext';
import { dataPath } from '../utils/dataDir';

export type ApprovalMode = 'alwaysAllow' | 'allowWithDryRun' | 'requireApproval' | 'deny' | 'allowForSession';

export interface ToolPolicyRule {
  id: string;
  description?: string;
  users?: string[];
  channels?: string[];
  skills?: string[];
  riskLevels?: SkillRiskLevel[];
  argumentPatterns?: Record<string, string>;
  schedule?: {
    daysOfWeek?: number[];
    startHourUtc?: number;
    endHourUtc?: number;
  };
  approvalMode: ApprovalMode;
}

export interface ToolPolicyConfig {
  version: 1;
  defaultApprovalMode?: ApprovalMode;
  rules: ToolPolicyRule[];
}

export interface ToolPolicyDecision {
  mode: ApprovalMode;
  decision: 'allowed' | 'dry_run_allowed' | 'approval_required' | 'denied';
  ruleId?: string;
  reason: string;
}

const DEFAULT_POLICY_FILE = 'policy.json';
const APPROVAL_MODE_TO_DECISION: Record<ApprovalMode, ToolPolicyDecision['decision']> = {
  alwaysAllow: 'allowed',
  allowForSession: 'allowed',
  allowWithDryRun: 'dry_run_allowed',
  requireApproval: 'approval_required',
  deny: 'denied',
};

let cachedPolicyPath: string | null = null;
let cachedPolicyMtimeMs = -1;
let cachedPolicy: ToolPolicyConfig | null = null;

export function getPolicyFilePath(): string {
  const raw = process.env.TOOL_POLICY_FILE;
  if (raw && raw.trim()) return path.resolve(raw);
  return dataPath(DEFAULT_POLICY_FILE);
}

export function loadToolPolicyConfig(): ToolPolicyConfig | null {
  const file = getPolicyFilePath();
  try {
    const stat = fs.statSync(file);
    if (cachedPolicy && cachedPolicyPath === file && cachedPolicyMtimeMs === stat.mtimeMs) return cachedPolicy;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ToolPolicyConfig;
    cachedPolicy = normalizePolicy(parsed);
    cachedPolicyPath = file;
    cachedPolicyMtimeMs = stat.mtimeMs;
    return cachedPolicy;
  } catch {
    cachedPolicy = null;
    cachedPolicyPath = file;
    cachedPolicyMtimeMs = -1;
    return null;
  }
}

export function evaluateToolPolicy(skill: SkillDefinition, args: Record<string, unknown>, now = new Date()): ToolPolicyDecision {
  const policy = loadToolPolicyConfig();
  if (!policy) {
    return fallbackDecision(skill);
  }

  const context = getSkillExecutionContext();
  for (const rule of policy.rules) {
    if (!matchesList(rule.skills, skill.name)) continue;
    if (!matchesList(rule.riskLevels, skill.riskLevel ?? 'low')) continue;
    if (!matchesList(rule.users, context?.personId)) continue;
    if (!matchesList(rule.channels, context?.channelKey)) continue;
    if (!matchesArguments(rule.argumentPatterns, args)) continue;
    if (!matchesSchedule(rule.schedule, now)) continue;
    return decisionFromMode(rule.approvalMode, rule.id, rule.description ?? `matched policy rule ${rule.id}`);
  }

  return decisionFromMode(policy.defaultApprovalMode ?? 'alwaysAllow', undefined, 'matched policy default');
}

export function describeSkillPolicy(skill: SkillDefinition): ToolPolicyDecision {
  return evaluateToolPolicy(skill, {});
}

export function _resetToolPolicyCacheForTests(): void {
  cachedPolicy = null;
  cachedPolicyPath = null;
  cachedPolicyMtimeMs = -1;
}

function normalizePolicy(policy: ToolPolicyConfig): ToolPolicyConfig {
  return {
    version: 1,
    defaultApprovalMode: normalizeApprovalMode(policy.defaultApprovalMode ?? 'alwaysAllow'),
    rules: Array.isArray(policy.rules)
      ? policy.rules.map((rule, index) => ({
        ...rule,
        id: String(rule.id ?? `rule_${index + 1}`),
        approvalMode: normalizeApprovalMode(rule.approvalMode),
      }))
      : [],
  };
}

function normalizeApprovalMode(mode: unknown): ApprovalMode {
  if (mode === 'allowWithDryRun' || mode === 'requireApproval' || mode === 'deny' || mode === 'allowForSession') return mode;
  return 'alwaysAllow';
}

function fallbackDecision(skill: SkillDefinition): ToolPolicyDecision {
  if ((process.env.HIL_ENABLED === 'true' || process.env.HIL_ENABLED === '1') && skill.riskLevel === 'high') {
    return decisionFromMode('requireApproval', undefined, 'HIL_ENABLED fallback requires approval for high-risk skills');
  }
  return decisionFromMode('alwaysAllow', undefined, 'no policy file configured');
}

function decisionFromMode(mode: ApprovalMode, ruleId: string | undefined, reason: string): ToolPolicyDecision {
  return { mode, decision: APPROVAL_MODE_TO_DECISION[mode], ruleId, reason };
}

function matchesList<T extends string>(patterns: T[] | undefined, value: string | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  if (!value) return false;
  return patterns.some((pattern) => matchesPattern(String(pattern), value));
}

function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.includes('*')) {
    const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`).test(value);
  }
  return pattern === value;
}

function matchesArguments(patterns: Record<string, string> | undefined, args: Record<string, unknown>): boolean {
  if (!patterns || Object.keys(patterns).length === 0) return true;
  return Object.entries(patterns).every(([key, pattern]) => {
    const value = getPath(args, key);
    return value !== undefined && new RegExp(pattern).test(String(value));
  });
}

function getPath(value: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

function matchesSchedule(schedule: ToolPolicyRule['schedule'] | undefined, now: Date): boolean {
  if (!schedule) return true;
  if (schedule.daysOfWeek && !schedule.daysOfWeek.includes(now.getUTCDay())) return false;
  const hour = now.getUTCHours();
  if (schedule.startHourUtc !== undefined && hour < schedule.startHourUtc) return false;
  if (schedule.endHourUtc !== undefined && hour >= schedule.endHourUtc) return false;
  return true;
}
