import { type SkillDefinition } from '../skill';
import { getExecutionBackend } from '../execution';

/**
 * Whitelist of allowed command names.
 * Only the base command name is checked — arguments can be anything that passes
 * the argument filter below.
 */
const ALLOWED_COMMANDS = new Set([
  'ls', 'dir', 'pwd', 'echo', 'date', 'whoami', 'hostname',
  'cat', 'head', 'tail', 'wc', 'grep', 'find', 'sort', 'uniq',
  'which', 'df', 'du', 'uname', 'uptime',
]);

/** Additional check: reject arguments that look like shell injection attempts. */
function hasDangerousArg(args: string[]): boolean {
  const dangerous = /[;&|`$%><!]|\.\.\/|\/etc\/|\/proc\/|\/sys\//;
  return args.some((a) => dangerous.test(a));
}

const MAX_OUTPUT_CHARS = 10_000;

export const runCommand: SkillDefinition = {
  name: 'runCommand',
  description:
    'Runs a whitelisted shell command and returns its output via the configured execution backend. ' +
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
  dryRun: async (args) => {
    const command = String(args.command ?? '').trim();
    const commandArgs: string[] = Array.isArray(args.args)
      ? (args.args as unknown[]).map((a) => String(a))
      : [];
    if (!command) throw new Error('command is required');
    if (!ALLOWED_COMMANDS.has(command)) throw new Error(`command \"${command}\" is not allowed`);
    if (hasDangerousArg(commandArgs)) throw new Error('one or more arguments contain disallowed characters');
    const rendered = [command, ...commandArgs].join(' ');
    return {
      summary: `Run whitelisted command: ${rendered}`,
      command: rendered,
      details: { command, args: commandArgs, backend: getExecutionBackend().kind },
      riskAttributes: ['process-execution'],
    };
  },
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
        content: 'Error: one or more arguments contain disallowed characters (;, |, &, >, $, %, !, .., /etc/, /proc/, /sys/).',
        isError: true,
      };
    }

    const backend = getExecutionBackend();
    const result = await backend.runCommand({ command, args: commandArgs });

    const stdout = result.stdout;
    const stderr = result.stderr;
    const code = result.exitCode;

    const combined = (stdout + (stderr ? `\n[stderr]: ${stderr}` : '')).trim();
    const truncated = combined.length > MAX_OUTPUT_CHARS
      ? combined.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]'
      : combined;

    const backendPrefix = result.backend !== 'local' ? `[backend: ${result.backend}]\n` : '';

    if (code !== 0 && !stdout) {
      return { content: backendPrefix + (truncated || `Command exited with code ${String(code)}`), isError: true };
    }
    return { content: backendPrefix + (truncated || `(no output, exit code ${String(code)})`) };
  },
};
