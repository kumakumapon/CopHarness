import { spawn } from 'node:child_process';
import { type SkillDefinition } from '../skill';

/**
 * Whitelist of allowed command names.
 * Only the base command name is checked — arguments can be anything that passes
 * the argument filter below.
 */
const ALLOWED_COMMANDS = new Set([
  'ls', 'dir', 'pwd', 'echo', 'date', 'whoami', 'hostname',
  'cat', 'head', 'tail', 'wc', 'grep', 'find', 'sort', 'uniq',
  'which', 'env', 'printenv', 'df', 'du', 'uname', 'uptime',
  'node', 'python3', 'python', 'ruby', 'go',
]);

/** Additional check: reject arguments that look like shell injection attempts. */
function hasDangerousArg(args: string[]): boolean {
  const dangerous = /[;&|`$><!]|\.\.\/|\/etc\/|\/proc\/|\/sys\//;
  return args.some((a) => dangerous.test(a));
}

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 10_000;

function runProcess(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    // On Windows, many simple commands (like echo) are built into cmd.exe and not available as standalone binaries.
    // Use cmd /c to run these commands on Windows while keeping spawn's shell:false to avoid extra shell parsing.
    const isWin = process.platform === 'win32';
    const spawnCmd = isWin ? 'cmd' : command;
    const spawnArgs = isWin ? ['/c', command, ...args] : args;
    const child = spawn(spawnCmd, spawnArgs, { shell: false, timeout: TIMEOUT_MS });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => { resolve({ stdout, stderr, code }); });
    child.on('error', (err) => { resolve({ stdout: '', stderr: err.message, code: -1 }); });
  });
}

export const runCommand: SkillDefinition = {
  name: 'runCommand',
  description:
    'Runs a whitelisted shell command and returns its output. ' +
    `Allowed commands: ${[...ALLOWED_COMMANDS].join(', ')}. ` +
    'Shell operators (|, ;, &&, etc.) are not supported.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: `The command to run (must be one of: ${[...ALLOWED_COMMANDS].join(', ')}).`,
      },
      args: {
        type: 'array',
        description: 'Arguments to pass to the command (no shell operators).',
        items: { type: 'string' },
      },
    },
    required: ['command'],
  },
  category: 'system',
  riskLevel: 'high',
  handler: async (args) => {
    const command = String(args.command ?? '').trim();
    if (!command) return { content: 'Error: command is required', isError: true };
    const commandArgs: string[] = Array.isArray(args.args)
      ? (args.args as unknown[]).map((a) => String(a))
      : [];

    if (!ALLOWED_COMMANDS.has(command)) {
      return {
        content: `Error: command "${command}" is not allowed. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
        isError: true,
      };
    }
    if (hasDangerousArg(commandArgs)) {
      return {
        content: 'Error: one or more arguments contain disallowed characters (;, |, &, >, $, !, .., /etc/, /proc/, /sys/).',
        isError: true,
      };
    }

    const { stdout, stderr, code } = await runProcess(command, commandArgs);
    const combined = (stdout + (stderr ? `\n[stderr]: ${stderr}` : '')).trim();
    const truncated = combined.length > MAX_OUTPUT_CHARS
      ? combined.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]'
      : combined;
    if (code !== 0 && !stdout) {
      return { content: truncated || `Command exited with code ${String(code)}`, isError: true };
    }
    return { content: truncated || `(no output, exit code ${String(code)})` };
  },
};
