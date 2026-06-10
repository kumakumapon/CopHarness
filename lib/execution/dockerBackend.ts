/**
 * Docker execution backend.
 * Runs commands and writes files inside an existing Docker container.
 *
 * Required env vars:
 *   EXECUTION_DOCKER_CONTAINER — container name or ID (required)
 *   EXECUTION_DOCKER_WORKDIR   — working directory inside container (default: /workspace)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
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

function spawnToResult(
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

/**
 * Enforce relative path: no leading '/', no '..' segments.
 * Returns the relative path unchanged if valid, throws otherwise.
 */
function enforceRelativePath(relativePath: string): void {
  if (relativePath.startsWith('/')) {
    throw new Error(`Path "${relativePath}" must be relative (no leading slash).`);
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    throw new Error(`Path "${relativePath}" must not contain '..' segments.`);
  }
}

export function createDockerBackend(): DockerBackend {
  const container = process.env.EXECUTION_DOCKER_CONTAINER;
  if (!container) {
    throw new Error(
      'EXECUTION_DOCKER_CONTAINER environment variable is required for the docker backend.',
    );
  }
  const workdir = process.env.EXECUTION_DOCKER_WORKDIR ?? '/workspace';
  const envAllowlist = (process.env.EXECUTION_ENV_ALLOWLIST ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const timeoutMs = parseInt(process.env.EXECUTION_TIMEOUT_MS ?? '10000', 10);
  return new DockerBackend(
    container,
    workdir,
    envAllowlist,
    isNaN(timeoutMs) ? DEFAULT_TIMEOUT_MS : timeoutMs,
  );
}

export class DockerBackend implements ExecutionBackend {
  readonly kind = 'docker' as const;

  constructor(
    private readonly container: string,
    private readonly workdir: string,
    private readonly envAllowlist: string[],
    private readonly defaultTimeoutMs: number,
  ) {}

  async runCommand(req: CommandRequest): Promise<CommandResult> {
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    // Build env flags for allowlisted vars that are set locally
    const envFlags: string[] = [];
    for (const key of this.envAllowlist) {
      const val = process.env[key];
      if (val !== undefined) {
        envFlags.push('-e', `${key}=${val}`);
      }
    }

    const dockerArgs = [
      'exec',
      '-w', this.workdir,
      ...envFlags,
      this.container,
      req.command,
      ...req.args,
    ];

    const { stdout, stderr, exitCode, timedOut } = await spawnToResult(
      'docker', dockerArgs, timeoutMs,
    );

    return { stdout, stderr, exitCode, timedOut, backend: 'docker' };
  }

  async writeFile(req: WriteFileRequest): Promise<WriteFileResult> {
    if (req.append) {
      throw new Error('append is not supported on docker/ssh backends.');
    }

    enforceRelativePath(req.relativePath);

    const targetPath = `${this.workdir}/${req.relativePath}`;
    const parentDir = path.posix.dirname(targetPath);

    // Write content to a local temp file
    const tmpFile = path.join(os.tmpdir(), `copharness-docker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(tmpFile, req.content, 'utf8');

    const timeoutMs = this.defaultTimeoutMs;

    try {
      // Create parent directory inside the container
      await spawnToResult(
        'docker',
        ['exec', this.container, 'mkdir', '-p', parentDir],
        timeoutMs,
      );

      // Copy the temp file into the container
      await spawnToResult(
        'docker',
        ['cp', tmpFile, `${this.container}:${targetPath}`],
        timeoutMs,
      );
    } finally {
      await fs.unlink(tmpFile).catch(() => { /* ignore */ });
    }

    return {
      path: targetPath,
      bytesWritten: Buffer.byteLength(req.content, 'utf8'),
      backend: 'docker',
    };
  }

  describe(): ExecutionBackendDescription {
    return {
      kind: 'docker',
      workingDir: this.workdir,
      envAllowlist: this.envAllowlist,
      timeoutMs: this.defaultTimeoutMs,
      detail: `container: ${this.container}`,
    };
  }
}
