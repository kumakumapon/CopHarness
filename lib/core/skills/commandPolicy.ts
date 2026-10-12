/**
 * Per-command argument policy for the `runCommand` skill.
 *
 * A bare command-name allowlist is not enough: several "read-only" commands
 * can delete files (`find -delete`, `find -exec`), write files (`sort -o`,
 * `find -fprint`, `uniq IN OUT`), change system state (`date -s`,
 * `hostname NAME`) or read outside the sandbox (`cat /abs/path`, `cat ../x`).
 * Every command therefore has an explicit spec: the flags it may take, which
 * flags take a value, and what its positional arguments mean. Anything not
 * listed is rejected.
 *
 * Path-like arguments must be relative to the execution working directory
 * (the sandbox) and must not climb out of it. This check is lexical and
 * backend-agnostic; the backends are responsible for actually running inside
 * the sandbox directory (local: cwd, docker: -w, ssh: cd).
 */

type ValueKind = 'number' | 'text' | 'path';

interface CommandSpec {
  /** Boolean short flags (single letters) that may appear, alone or clustered. */
  flags?: string;
  /** Short flags that take a value (`-n 5`, `-n5`) and the kind of value. */
  valueFlags?: Record<string, ValueKind>;
  /** Accept head/tail style `-5`. */
  numericShort?: boolean;
  /** Accept Windows `dir`-style `/x` switches. */
  slashSwitches?: boolean;
  /** What positional arguments are. `grep` treats the first one as a pattern. */
  positional: 'none' | 'text' | 'paths' | 'grep';
  /** Minimum number of positional arguments (guards against reading stdin forever). */
  minPositional?: number;
  /** Maximum number of positional arguments. */
  maxPositional?: number;
}

const NUMBER = /^[+-]?\d{1,9}$/;

const POSIX_SPECS: Record<string, CommandSpec> = {
  ls: { flags: 'aAlhR1trSdFis', positional: 'paths' },
  pwd: { flags: 'LP', positional: 'none' },
  echo: { positional: 'text' },
  date: { flags: 'u', positional: 'none' },
  whoami: { positional: 'none' },
  hostname: { positional: 'none' },
  cat: { flags: 'nbsETv', positional: 'paths', minPositional: 1 },
  head: { flags: 'qv', valueFlags: { n: 'number', c: 'number' }, numericShort: true, positional: 'paths', minPositional: 1 },
  tail: { flags: 'qv', valueFlags: { n: 'number', c: 'number' }, numericShort: true, positional: 'paths', minPositional: 1 },
  wc: { flags: 'lwcmL', positional: 'paths', minPositional: 1 },
  grep: {
    flags: 'ivnclLwxEFrHhoqsa',
    valueFlags: { e: 'text', m: 'number', A: 'number', B: 'number', C: 'number' },
    positional: 'grep',
  },
  find: { positional: 'paths' }, // custom parser, see validateFind
  sort: { flags: 'rnufbdhVgMs', valueFlags: { k: 'text', t: 'text' }, positional: 'paths', minPositional: 1 },
  // `uniq INPUT OUTPUT` writes OUTPUT, so only one positional is allowed.
  uniq: { flags: 'cdui', positional: 'paths', minPositional: 1, maxPositional: 1 },
  which: { flags: 'a', positional: 'text', minPositional: 1 },
  df: { flags: 'hkTia', positional: 'paths' },
  du: { flags: 'ahscbkm', valueFlags: { d: 'number' }, positional: 'paths' },
  uname: { flags: 'asnrvmo', positional: 'none' },
  uptime: { flags: 'ps', positional: 'none' },
};

/** Windows (cmd.exe) has no cat/grep/find(1)/...; only expose what exists. */
const WINDOWS_SPECS: Record<string, CommandSpec> = {
  dir: { slashSwitches: true, positional: 'paths' },
  echo: { positional: 'text' },
  whoami: { positional: 'none' },
  hostname: { positional: 'none' },
  type: { positional: 'paths', minPositional: 1 },
};

/** `find` primaries: zero-argument, value-taking, and value-is-a-path. */
const FIND_BARE = new Set([
  '-empty', '-print', '-print0', '-not', '-a', '-o', '-and', '-or', '-true', '-false',
  '-readable', '-writable', '-executable', '-depth', '-prune', '-mount', '-xdev', '!', '(', ')',
]);
const FIND_TEXT = new Set([
  '-name', '-iname', '-path', '-ipath', '-type', '-size', '-mtime', '-mmin', '-atime', '-amin',
  '-ctime', '-cmin', '-perm', '-user', '-group', '-maxdepth', '-mindepth', '-regex', '-iregex',
]);
const FIND_PATH = new Set(['-newer']);

function specsFor(platform: NodeJS.Platform): Record<string, CommandSpec> {
  return platform === 'win32' ? WINDOWS_SPECS : POSIX_SPECS;
}

/** Names of the commands runnable on the given platform. */
export function getAllowedCommandNames(platform: NodeJS.Platform = process.platform): string[] {
  return Object.keys(specsFor(platform));
}

/** True when `arg` is a relative path that stays inside the working directory. */
export function isSafeRelativePath(arg: string): boolean {
  if (arg.includes('\0')) return false;
  const unified = arg.replace(/\\/g, '/');
  if (unified.startsWith('/') || unified.startsWith('~') || /^[a-zA-Z]:/.test(unified)) return false;
  const normalized = unified.split('/').reduce<string[] | null>((stack, part) => {
    if (!stack) return null;
    if (part === '' || part === '.') return stack;
    if (part === '..') return stack.length > 0 ? (stack.pop(), stack) : null;
    stack.push(part);
    return stack;
  }, []);
  return normalized !== null;
}

function checkValue(kind: ValueKind, value: string | undefined, flag: string): string | null {
  if (value === undefined) return `option "${flag}" requires a value`;
  if (kind === 'number' && !NUMBER.test(value)) return `option "${flag}" requires a numeric value`;
  if (kind === 'path' && !isSafeRelativePath(value)) return `path "${value}" is outside the sandbox directory`;
  return null;
}

function validateFind(args: string[]): string | null {
  let i = 0;
  // Starting points: everything before the first expression token.
  while (i < args.length && !args[i].startsWith('-') && args[i] !== '!' && args[i] !== '(') {
    if (!isSafeRelativePath(args[i])) return `path "${args[i]}" is outside the sandbox directory`;
    i += 1;
  }
  for (; i < args.length; i += 1) {
    const token = args[i];
    if (FIND_BARE.has(token)) continue;
    if (FIND_TEXT.has(token) || FIND_PATH.has(token)) {
      const value = args[i + 1];
      if (value === undefined) return `find primary "${token}" requires a value`;
      if (FIND_PATH.has(token) && !isSafeRelativePath(value)) {
        return `path "${value}" is outside the sandbox directory`;
      }
      i += 1;
      continue;
    }
    return `find primary "${token}" is not allowed (only read-only primaries are permitted)`;
  }
  return null;
}

/**
 * Validate a command invocation against its spec.
 * Returns an error message, or `null` when the invocation is acceptable.
 */
export function validateCommandInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  const spec = specsFor(platform)[command];
  if (!spec) return `command "${command}" is not allowed`;
  if (command === 'find') return validateFind(args);

  const positional: string[] = [];
  let usedExplicitPattern = false;
  let recursive = false;
  let endOfOptions = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (command === 'echo') { positional.push(arg); continue; }

    if (endOfOptions || arg === '-' || !arg.startsWith('-')) {
      if (spec.slashSwitches && !endOfOptions && /^\/[a-zA-Z](:[a-zA-Z-]+)?$/.test(arg)) continue;
      positional.push(arg);
      continue;
    }
    if (arg === '--') { endOfOptions = true; continue; }
    if (arg.startsWith('--')) return `option "${arg}" is not allowed for ${command}`;

    if (spec.numericShort && /^-\d{1,9}$/.test(arg)) continue;

    // Short option cluster, e.g. -la or -n5.
    for (let j = 1; j < arg.length; j += 1) {
      const letter = arg[j];
      const valueKind = spec.valueFlags?.[letter];
      if (valueKind) {
        const attached = arg.slice(j + 1);
        let value: string | undefined = attached;
        if (attached === '') { value = args[i + 1]; i += 1; }
        const problem = checkValue(valueKind, value, `-${letter}`);
        if (problem) return problem;
        if (command === 'grep' && letter === 'e') usedExplicitPattern = true;
        break;
      }
      if (!spec.flags?.includes(letter)) return `option "-${letter}" is not allowed for ${command}`;
      if (letter === 'r' && command === 'grep') recursive = true;
    }
  }

  const count = positional.length;
  if (spec.positional === 'none' && count > 0) return `${command} does not take arguments`;
  if (spec.maxPositional !== undefined && count > spec.maxPositional) {
    return `${command} accepts at most ${spec.maxPositional} file argument(s)`;
  }

  if (spec.positional === 'grep') {
    const paths = usedExplicitPattern ? positional : positional.slice(1);
    if (!usedExplicitPattern && count < 1) return 'grep requires a pattern';
    if (paths.length === 0 && !recursive) return 'grep requires at least one file (or -r)';
    for (const p of paths) if (!isSafeRelativePath(p)) return `path "${p}" is outside the sandbox directory`;
    return null;
  }

  if (spec.minPositional !== undefined && count < spec.minPositional) {
    return `${command} requires at least ${spec.minPositional} argument(s)`;
  }
  if (spec.positional === 'paths') {
    for (const p of positional) if (!isSafeRelativePath(p)) return `path "${p}" is outside the sandbox directory`;
  }
  return null;
}
