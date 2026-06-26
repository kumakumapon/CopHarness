/**
 * Shared spawn helper used by dockerBackend and sshBackend.
 */

import { spawn } from 'node:child_process';
import { MAX_OUTPUT_CHARS } from './types';

export function spawnToResult(
  cmd: string,
  args: string[],
  timeoutMs: number,
  stdin?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]';
      if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]';
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: -1, timedOut: false });
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin, 'utf8');
      child.stdin.end();
    }
  });
}
