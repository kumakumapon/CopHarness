import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { str, truncateMiddle, type Tool } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT = 30_000;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|COOKIE|SESSION)/i;

/** Environment for child processes: credentials the harness holds are not passed on. */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || SECRET_NAME.test(k) || k.startsWith('COPHARNESS_')) continue;
    env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

export const bashTool: Tool = {
  name: 'bash',
  description: [
    'ワークスペースをカレントディレクトリとしてシェルコマンドを実行し、終了コードと出力を返す。',
    'git、ビルド、テスト、ファイル操作など汎用に使える。対話的なコマンドやサーバーの常駐起動は避ける。',
    `既定のタイムアウトは ${DEFAULT_TIMEOUT_MS / 1000} 秒（timeout_ms で最大 ${MAX_TIMEOUT_MS / 1000} 秒）。`,
  ].join(''),
  access: 'execute',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '実行するコマンド' },
      timeout_ms: { type: 'integer', minimum: 1000, maximum: MAX_TIMEOUT_MS },
    },
    required: ['command'],
  },
  subject: input => str(input.command),
  summarize: input => str(input.command),
  run(input, ctx) {
    const command = str(input.command);
    const timeoutMs = Math.min(Number(input.timeout_ms) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    fs.mkdirSync(ctx.workspace, { recursive: true });
    const isWin = process.platform === 'win32';
    return new Promise(resolve => {
      const child = isWin
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: ctx.workspace, env: childEnv(), windowsHide: true })
        : spawn('/bin/sh', ['-c', command], { cwd: ctx.workspace, env: childEnv(), detached: true });
      let out = '';
      const append = (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.length > MAX_OUTPUT * 4) out = truncateMiddle(out, MAX_OUTPUT * 2);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      let reason: string | undefined;
      const kill = (why: string) => {
        reason = why;
        try {
          if (!isWin && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* already exited */ }
      };
      const timer = setTimeout(() => kill(`${timeoutMs / 1000} 秒でタイムアウトしました`), timeoutMs);
      const onAbort = () => kill('中断されました');
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      const finish = (code: number | null, error?: Error) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        const body = truncateMiddle(out.trimEnd(), MAX_OUTPUT);
        if (error) return resolve({ content: `コマンドを開始できません: ${error.message}`, isError: true });
        const header = reason ? `[${reason}]` : `[exit ${code}]`;
        resolve({ content: `${header}\n${body || '（出力なし）'}`, isError: Boolean(reason) || code !== 0 });
      };
      child.on('error', err => finish(null, err));
      child.on('close', code => finish(code));
    });
  },
};
