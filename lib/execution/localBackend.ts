/**
 * Local execution backend.
 * Runs commands via spawn() and writes files to the local sandbox directory.
 * This is the default backend and replicates the exact behavior of the
 * original runCommand.ts and writeFile.ts skill implementations.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type ExecutionBackend,
  type ExecutionBackendDescription,
  type CommandRequest,
  type CommandResult,
  type WriteFileRequest,
  type WriteFileResult,
} from './types';

const MAX_OUTPUT_CHARS = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Resolve and return the absolute sandbox directory path, creating it if needed. */
async function getSandboxDir(): Promise<string> {
  const raw = process.env.SKILL_FILE_SANDBOX_DIR ?? './workspace';
  const dir = path.resolve(raw);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a user-supplied relative or absolute path to an absolute path inside the sandbox.
 * Throws if the resolved path escapes the sandbox directory.
 */
async function resolveSafe(userPath: string): Promise<string> {
  const sandbox = await getSandboxDir();
  // Strip leading slashes so joining doesn't treat it as absolute
  const stripped = userPath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(sandbox, stripped);
  if (!resolved.startsWith(sandbox + path.sep) && resolved !== sandbox) {
    throw new Error(`Path "${userPath}" is outside the allowed sandbox directory.`);
  }
  return resolved;
}

export class LocalBackend implements ExecutionBackend {
  readonly kind = 'local' as const;

  async runCommand(req: CommandRequest): Promise<CommandResult> {
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const spawnCmd = isWin ? 'cmd' : req.command;
      const spawnArgs = isWin ? ['/c', req.command, ...req.args] : req.args;

      let timedOut = false;
      const child = spawn(spawnCmd, spawnArgs, { shell: false });
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
        // Cap output
        if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]';
        if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]';
        resolve({ stdout, stderr, exitCode: code, timedOut, backend: 'local' });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: err.message, exitCode: -1, timedOut: false, backend: 'local' });
      });
    });
  }

  async writeFile(req: WriteFileRequest): Promise<WriteFileResult> {
    const resolved = await resolveSafe(req.relativePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    if (req.append) {
      await fs.appendFile(resolved, req.content, 'utf8');
    } else {
      await fs.writeFile(resolved, req.content, 'utf8');
    }
    return {
      path: resolved,
      bytesWritten: Buffer.byteLength(req.content, 'utf8'),
      backend: 'local',
    };
  }

  describe(): ExecutionBackendDescription {
    const envAllowlist = (process.env.EXECUTION_ENV_ALLOWLIST ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const timeoutMs = parseInt(process.env.EXECUTION_TIMEOUT_MS ?? '10000', 10);
    return {
      kind: 'local',
      workingDir: process.cwd(),
      envAllowlist,
      timeoutMs: isNaN(timeoutMs) ? DEFAULT_TIMEOUT_MS : timeoutMs,
    };
  }
}
