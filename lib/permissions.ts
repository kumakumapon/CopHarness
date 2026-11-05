/**
 * Permission decisions: deny rules > ask rules > allow rules > mode defaults.
 *
 * Rules look like `tool` or `tool(pattern)`; `*` matches anything. The
 * pattern is matched against the tool's subject (bash: the command, file
 * tools: the path, web_fetch: the host). Tool names may use globs too:
 * `mcp__github__*`.
 */
import type { PermissionMode } from './config';
import type { Tool, ToolAccess } from './tools/types';

export type PermissionVerdict = 'allow' | 'ask' | 'deny';

export interface PermissionRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface PermissionResult {
  verdict: PermissionVerdict;
  reason: string;
}

const MODE_DEFAULTS: Record<PermissionMode, Record<ToolAccess, PermissionVerdict>> = {
  default: { read: 'allow', state: 'allow', edit: 'ask', execute: 'ask' },
  acceptEdits: { read: 'allow', state: 'allow', edit: 'allow', execute: 'ask' },
  readonly: { read: 'allow', state: 'allow', edit: 'deny', execute: 'deny' },
  bypass: { read: 'allow', state: 'allow', edit: 'allow', execute: 'allow' },
};

const ACCESS_REASON: Record<ToolAccess, string> = {
  read: '読み取りのみの操作',
  state: '会話内の状態の更新',
  edit: 'ワークスペースのファイルを変更する操作',
  execute: 'コマンド実行や外部への操作',
};

function globMatch(pattern: string, value: string): boolean {
  const re = pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*');
  return new RegExp(`^${re}$`).test(value);
}

export function parseRule(rule: string): { tool: string; pattern?: string } {
  const m = rule.trim().match(/^([^()]+?)\s*(?:\((.*)\))?$/);
  if (!m) return { tool: rule.trim() };
  return { tool: m[1].trim(), pattern: m[2]?.trim() };
}

/** Characters that let one shell command run another. */
const SHELL_CHAIN = /[;&|`\n<>]|\$\(/;

/** Split a command line on chaining operators so deny rules see every part. */
export function splitShellCommand(command: string): string[] {
  return command.split(/&&|\|\||[;&|\n]/).map(s => s.trim()).filter(Boolean);
}

function ruleMatches(rule: string, tool: Tool, subject: string | undefined, kind: 'allow' | 'deny' | 'ask'): boolean {
  const { tool: name, pattern } = parseRule(rule);
  if (!globMatch(name, tool.name)) return false;
  if (pattern === undefined || pattern === '*') return true;
  if (subject === undefined) return false;
  if (tool.name === 'bash') {
    if (kind === 'allow') {
      // A wildcard allow rule never covers a compound command such as `git status; rm -rf ~`.
      return SHELL_CHAIN.test(subject) ? pattern === subject : globMatch(pattern, subject);
    }
    return globMatch(pattern, subject) || splitShellCommand(subject).some(part => globMatch(pattern, part));
  }
  return globMatch(pattern, subject);
}

export function evaluatePermission(options: {
  tool: Tool;
  input: Record<string, unknown>;
  mode: PermissionMode;
  rules: PermissionRules;
  /** Rules granted with "always allow" during this session. */
  sessionAllow?: string[];
}): PermissionResult {
  const { tool, input, mode, rules } = options;
  let subject: string | undefined;
  try { subject = tool.subject?.(input); } catch { subject = undefined; }
  const find = (list: string[], kind: 'allow' | 'deny' | 'ask') => list.find(r => ruleMatches(r, tool, subject, kind));

  const denied = find(rules.deny, 'deny');
  if (denied) return { verdict: 'deny', reason: `ルール ${denied} により拒否` };
  const fallback = MODE_DEFAULTS[mode][tool.access];
  if (mode === 'readonly' && fallback === 'deny') return { verdict: 'deny', reason: '読み取り専用モードです' };
  const asked = find(rules.ask, 'ask');
  if (asked) return { verdict: 'ask', reason: `ルール ${asked} により確認が必要` };
  const allowed = find(rules.allow, 'allow') ?? find(options.sessionAllow ?? [], 'allow');
  if (allowed) return { verdict: 'allow', reason: `ルール ${allowed} により許可` };
  return { verdict: fallback, reason: `${ACCESS_REASON[tool.access]}です（${mode} モード）` };
}

/** The rule remembered when the user chooses "always allow" for this call. */
export function alwaysAllowRule(tool: Tool, input: Record<string, unknown>): string {
  if (tool.name === 'bash') {
    const command = String(input.command ?? '').trim();
    return `bash(${command})`;
  }
  return tool.name;
}
