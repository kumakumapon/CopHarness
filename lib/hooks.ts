/**
 * Command hooks. Each hook is a shell command that receives a JSON payload on
 * stdin. Exit code 2 blocks the action (stderr is the reason shown to the
 * model); exit code 0 may print JSON such as
 *   {"decision": "deny" | "allow" | "ask", "reason": "...", "additionalContext": "..."}
 * Other exit codes are reported but do not block.
 */
import { spawn } from 'node:child_process';
import type { HookConfig, HookEvent } from './config';
import { childEnv } from './tools/bash';

export interface HookOutcome {
  blocked?: string;
  decision?: 'allow' | 'deny' | 'ask';
  reason?: string;
  additionalContext: string[];
  errors: string[];
}

function runOne(hook: HookConfig, payload: unknown, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', hook.command], { cwd, env: childEnv(), windowsHide: true })
      : spawn('/bin/sh', ['-c', hook.command], { cwd, env: childEnv() });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { stderr += '\n(timeout)'; child.kill('SIGKILL'); }, hook.timeoutMs ?? 30_000);
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', err => { clearTimeout(timer); resolve({ code: null, stdout, stderr: err.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function runHooks(
  hooks: Partial<Record<HookEvent, HookConfig[]>>,
  event: HookEvent,
  payload: Record<string, unknown>,
  options: { cwd: string; toolName?: string },
): Promise<HookOutcome> {
  const outcome: HookOutcome = { additionalContext: [], errors: [] };
  const matching = (hooks[event] ?? []).filter(h => {
    if (!h.matcher || !options.toolName) return true;
    try { return new RegExp(`^(?:${h.matcher})$`).test(options.toolName); } catch { return false; }
  });
  for (const hook of matching) {
    const { code, stdout, stderr } = await runOne(hook, { event, ...payload }, options.cwd);
    if (code === 2) {
      outcome.blocked = stderr.trim() || `フック "${hook.command}" により中止されました`;
      return outcome;
    }
    if (code !== 0) {
      outcome.errors.push(`フック "${hook.command}" が失敗しました（exit ${code}）: ${stderr.trim().slice(0, 300)}`);
      continue;
    }
    const text = stdout.trim();
    if (!text) continue;
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as { decision?: string; reason?: string; additionalContext?: string };
        if (parsed.decision === 'deny' || parsed.decision === 'allow' || parsed.decision === 'ask') {
          outcome.decision = parsed.decision;
          outcome.reason = parsed.reason;
          if (parsed.decision === 'deny') return outcome;
        }
        if (parsed.additionalContext) outcome.additionalContext.push(parsed.additionalContext);
        continue;
      } catch { /* treat as plain text */ }
    }
    outcome.additionalContext.push(text);
  }
  return outcome;
}
