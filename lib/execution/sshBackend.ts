/**
 * SSH execution backend.
 * Runs commands and writes files on a remote host via SSH.
 *
 * Required env vars:
 *   EXECUTION_SSH_HOST      — remote hostname (required)
 *
 * Optional env vars:
 *   EXECUTION_SSH_USER      — remote user (e.g. "ubuntu"); if set, connects as user@host
 *   EXECUTION_SSH_PORT      — SSH port (e.g. "2222")
 *   EXECUTION_SSH_IDENTITY  — path to private key file (passed as -i)
 *   EXECUTION_SSH_WORKDIR   — working directory on remote host (default: "~")
 */

import {
  type ExecutionBackend,
  type ExecutionBackendDescription,
  type CommandRequest,
  type CommandResult,
  type WriteFileRequest,
  type WriteFileResult,
  type ReadFileRequest,
  type ReadFileResult,
  type ListDirRequest,
  type ListDirResult,
  type ListDirEntry,
  DEFAULT_TIMEOUT_MS,
} from './types';
import {
  enforceAllowedPath,
  enforceNetworkPolicy,
  enforceRelativePath,
  getAllowedPathPrefixes,
  getNetworkPolicy,
} from './policy';
import { spawnToResult } from './spawnUtils';

/**
 * Wrap a value in single quotes, escaping any embedded single quotes
 * using the shell idiom: end quote, insert literal ', resume quote.
 * e.g. "it's" → "'it'\"'\"'s'"  → no, actually → "'it'\\''s'"
 * Correct shell idiom: 'it'"'"'s'
 */
export function shellQuote(value: string): string {
  // Escape embedded single quotes: replace ' with '"'"'
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

/**
 * Resolve the configured workdir to a path usable inside a quoted remote
 * command. SSH remote commands start in the login user's home directory,
 * and quoting a literal '~' would defeat tilde expansion on the remote
 * shell, so '~' maps to '.' and '~/x' maps to 'x'.
 */
function remoteWorkdirPath(workdir: string): string {
  if (workdir === '~' || workdir === '~/') return '.';
  if (workdir.startsWith('~/')) return workdir.slice(2);
  return workdir;
}

export interface SshBackendConfig {
  host: string;
  user?: string;
  port?: string;
  identityFile?: string;
  workdir: string;
  envAllowlist: string[];
  defaultTimeoutMs: number;
}

export function createSshBackend(): SshBackend {
  const host = process.env.EXECUTION_SSH_HOST;
  if (!host) {
    throw new Error(
      'EXECUTION_SSH_HOST environment variable is required for the ssh backend.',
    );
  }
  const envAllowlist = (process.env.EXECUTION_ENV_ALLOWLIST ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const timeoutMs = parseInt(process.env.EXECUTION_TIMEOUT_MS ?? '10000', 10);
  return new SshBackend({
    host,
    user: process.env.EXECUTION_SSH_USER,
    port: process.env.EXECUTION_SSH_PORT,
    identityFile: process.env.EXECUTION_SSH_IDENTITY,
    workdir: process.env.EXECUTION_SSH_WORKDIR ?? '~',
    envAllowlist,
    defaultTimeoutMs: isNaN(timeoutMs) ? DEFAULT_TIMEOUT_MS : timeoutMs,
  });
}

export class SshBackend implements ExecutionBackend {
  readonly kind = 'ssh' as const;
  private readonly config: SshBackendConfig;

  constructor(config: SshBackendConfig) {
    this.config = config;
  }

  /** Build the base SSH argv (flags only, no destination or remote command). */
  private buildSshBaseArgs(): string[] {
    const args: string[] = [];
    if (this.config.port) {
      args.push('-p', this.config.port);
    }
    if (this.config.identityFile) {
      args.push('-i', this.config.identityFile);
    }
    return args;
  }

  /** Return "user@host" or just "host" depending on config. */
  private destination(): string {
    return this.config.user ? `${this.config.user}@${this.config.host}` : this.config.host;
  }

  async runCommand(req: CommandRequest): Promise<CommandResult> {
    enforceNetworkPolicy(req.command);
    const timeoutMs = req.timeoutMs ?? this.config.defaultTimeoutMs;

    // Build the env prefix for allowlisted vars
    const envParts: string[] = [];
    for (const key of this.config.envAllowlist) {
      const val = process.env[key];
      if (val !== undefined) {
        envParts.push(`${key}=${shellQuote(val)}`);
      }
    }

    // Assemble remote command string
    const quotedWorkdir = shellQuote(remoteWorkdirPath(this.config.workdir));
    const quotedCmd = shellQuote(req.command);
    const quotedArgs = req.args.map(shellQuote);
    const envPrefix = envParts.length > 0 ? `env ${envParts.join(' ')} ` : '';
    const remoteCmd = `cd ${quotedWorkdir} && ${envPrefix}${quotedCmd} ${quotedArgs.join(' ')}`;

    const sshArgs = [
      ...this.buildSshBaseArgs(),
      this.destination(),
      '--',
      remoteCmd,
    ];

    const { stdout, stderr, exitCode, timedOut } = await spawnToResult(
      'ssh', sshArgs, timeoutMs,
    );

    return { stdout, stderr, exitCode, timedOut, backend: 'ssh' };
  }

  async writeFile(req: WriteFileRequest): Promise<WriteFileResult> {
    enforceRelativePath(req.relativePath);
    enforceAllowedPath(req.relativePath);

    const workdir = this.config.workdir;
    const remoteBase = remoteWorkdirPath(workdir);
    const remoteTarget = remoteBase === '.' ? req.relativePath : `${remoteBase}/${req.relativePath}`;
    const slash = remoteTarget.lastIndexOf('/');
    const remoteParent = slash > 0 ? remoteTarget.slice(0, slash) : '.';
    // Display path keeps the raw workdir (may contain '~') for readability.
    const targetPath = `${workdir}/${req.relativePath}`;

    const timeoutMs = this.config.defaultTimeoutMs;
    const quotedParent = shellQuote(remoteParent);
    const quotedTarget = shellQuote(remoteTarget);

    const redirect = req.append ? '>>' : '>';
    const mkdirCmd = `mkdir -p ${quotedParent} && cat ${redirect} ${quotedTarget}`;
    const sshArgs = [
      ...this.buildSshBaseArgs(),
      this.destination(),
      '--',
      mkdirCmd,
    ];

    const { exitCode, stderr, timedOut } = await spawnToResult(
      'ssh', sshArgs, timeoutMs, req.content,
    );

    if (timedOut) {
      throw new Error('SSH writeFile timed out.');
    }
    if (exitCode !== 0) {
      throw new Error(`SSH writeFile failed (exit ${exitCode ?? 'null'}): ${stderr}`);
    }

    return {
      path: targetPath,
      bytesWritten: Buffer.byteLength(req.content, 'utf8'),
      backend: 'ssh',
    };
  }

  async readFile(req: ReadFileRequest): Promise<ReadFileResult> {
    enforceRelativePath(req.relativePath);
    enforceAllowedPath(req.relativePath);
    const maxBytes = req.maxBytes ?? 100_000;
    const remoteBase = remoteWorkdirPath(this.config.workdir);
    const remoteTarget = remoteBase === '.' ? req.relativePath : `${remoteBase}/${req.relativePath}`;
    const headCount = maxBytes + 1;
    const remoteCmd = `head -c ${headCount} ${shellQuote(remoteTarget)}`;
    const sshArgs = [
      ...this.buildSshBaseArgs(),
      this.destination(),
      '--',
      remoteCmd,
    ];
    const { stdout, stderr, exitCode, timedOut } = await spawnToResult(
      'ssh', sshArgs, this.config.defaultTimeoutMs,
    );
    if (timedOut) {
      throw new Error('SSH readFile timed out.');
    }
    if (exitCode !== 0) {
      throw new Error(`SSH readFile failed (exit ${exitCode ?? 'null'}): ${stderr}`);
    }
    if (stdout.length > maxBytes) {
      return { content: stdout.slice(0, maxBytes), truncated: true, backend: 'ssh' };
    }
    return { content: stdout, truncated: false, backend: 'ssh' };
  }

  async listDir(req: ListDirRequest): Promise<ListDirResult> {
    const relativePath = req.relativePath ?? '.';
    enforceAllowedPath(relativePath);
    const remoteBase = remoteWorkdirPath(this.config.workdir);
    let remoteTarget: string;
    if (relativePath === '.') {
      remoteTarget = remoteBase;
    } else {
      enforceRelativePath(relativePath);
      remoteTarget = remoteBase === '.' ? relativePath : `${remoteBase}/${relativePath}`;
    }
    const remoteCmd = `ls -1p ${shellQuote(remoteTarget)}`;
    const sshArgs = [
      ...this.buildSshBaseArgs(),
      this.destination(),
      '--',
      remoteCmd,
    ];
    const { stdout, stderr, exitCode, timedOut } = await spawnToResult(
      'ssh', sshArgs, this.config.defaultTimeoutMs,
    );
    if (timedOut) {
      throw new Error('SSH listDir timed out.');
    }
    if (exitCode !== 0) {
      throw new Error(`SSH listDir failed (exit ${exitCode ?? 'null'}): ${stderr}`);
    }
    const lines = stdout.split('\n').filter((l) => l.length > 0);
    const entries: ListDirEntry[] = lines.map((line) => {
      if (line.endsWith('/')) {
        return { name: line.slice(0, -1), type: 'directory' as const };
      }
      return { name: line, type: 'file' as const };
    });
    return { entries, backend: 'ssh' };
  }

  describe(): ExecutionBackendDescription {
    const detail = [
      `host: ${this.config.host}`,
      this.config.user ? `user: ${this.config.user}` : null,
      this.config.port ? `port: ${this.config.port}` : null,
    ].filter(Boolean).join(', ');

    return {
      kind: 'ssh',
      workingDir: this.config.workdir,
      envAllowlist: this.config.envAllowlist,
      timeoutMs: this.config.defaultTimeoutMs,
      detail,
      allowedPaths: getAllowedPathPrefixes() ?? undefined,
      networkPolicy: getNetworkPolicy(),
    };
  }
}
