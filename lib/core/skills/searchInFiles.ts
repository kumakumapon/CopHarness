import { type SkillDefinition } from '../skill';
import { getExecutionBackend } from '../execution';
import { type ExecutionBackend } from '../execution/types';

const MAX_RESULTS = 200;
const MAX_FILE_SIZE_BYTES = 1_000_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;

function getSearchTimeoutMs(): number {
  const raw = process.env.SEARCH_IN_FILES_TIMEOUT_MS ?? process.env.EXECUTION_TIMEOUT_MS;
  if (!raw) return DEFAULT_SEARCH_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SEARCH_TIMEOUT_MS;
}

function assertNotTimedOut(deadlineMs: number): void {
  if (Date.now() >= deadlineMs) {
    throw new Error('searchInFiles timed out.');
  }
}

function joinRelativePath(base: string, name: string): string {
  if (base === '.' || base === '') return name;
  return `${base.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`;
}

async function tryReadFile(
  backend: ExecutionBackend,
  relativePath: string,
  deadlineMs: number,
): Promise<string | null> {
  assertNotTimedOut(deadlineMs);
  try {
    const result = await backend.readFile({
      relativePath,
      maxBytes: MAX_FILE_SIZE_BYTES + 1,
    });
    assertNotTimedOut(deadlineMs);
    if (result.truncated || result.content.length > MAX_FILE_SIZE_BYTES) return null;
    return result.content;
  } catch (err) {
    if (err instanceof Error && err.message === 'searchInFiles timed out.') throw err;
    return null;
  }
}

function collectLineMatches(
  content: string,
  relPath: string,
  regex: RegExp,
  matches: string[],
): void {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (matches.length >= MAX_RESULTS) break;
    if (regex.test(lines[i])) {
      matches.push(`${relPath}:${i + 1}: ${lines[i]}`);
    }
  }
}

async function searchFile(
  backend: ExecutionBackend,
  relativePath: string,
  regex: RegExp,
  matches: string[],
  size: number | undefined,
  deadlineMs: number,
): Promise<void> {
  assertNotTimedOut(deadlineMs);
  if (matches.length >= MAX_RESULTS) return;
  if (size !== undefined && size > MAX_FILE_SIZE_BYTES) return;
  const content = await tryReadFile(backend, relativePath, deadlineMs);
  if (content === null) return;
  collectLineMatches(content, relativePath, regex, matches);
}

async function searchDirectory(
  backend: ExecutionBackend,
  relativePath: string,
  regex: RegExp,
  matches: string[],
  deadlineMs: number,
): Promise<void> {
  assertNotTimedOut(deadlineMs);
  if (matches.length >= MAX_RESULTS) return;
  const result = await backend.listDir({ relativePath });
  assertNotTimedOut(deadlineMs);
  for (const entry of result.entries) {
    if (matches.length >= MAX_RESULTS) break;
    const childPath = joinRelativePath(relativePath, entry.name);
    if (entry.type === 'directory') {
      await searchDirectory(backend, childPath, regex, matches, deadlineMs);
    } else if (entry.type === 'file') {
      await searchFile(backend, childPath, regex, matches, entry.size, deadlineMs);
    }
  }
}

async function searchPath(
  backend: ExecutionBackend,
  relativePath: string,
  regex: RegExp,
  matches: string[],
  deadlineMs: number,
): Promise<void> {
  assertNotTimedOut(deadlineMs);
  try {
    await searchDirectory(backend, relativePath, regex, matches, deadlineMs);
  } catch (dirErr) {
    const content = await tryReadFile(backend, relativePath, deadlineMs);
    if (content === null) {
      throw dirErr;
    }
    collectLineMatches(content, relativePath, regex, matches);
  }
}

export const searchInFiles: SkillDefinition = {
  name: 'searchInFiles',
  description:
    'Searches for a text pattern in files within the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace) ' +
    'via the configured execution backend. ' +
    'Returns matching lines with file path and line number (up to 200 matches).',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Text or regular expression pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'Relative path to search in (file or directory). Defaults to "." (sandbox root).',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive. Defaults to false.',
      },
    },
    required: ['pattern'],
  },
  category: 'file',
  riskLevel: 'low',
  handler: async (args) => {
    const patternStr = String(args.pattern ?? '').trim();
    const userPath = String(args.path ?? '.').trim() || '.';
    const caseSensitive = args.caseSensitive === true;
    if (!patternStr) return { content: 'Error: pattern is required', isError: true };

    let regex: RegExp;
    try {
      regex = new RegExp(patternStr, caseSensitive ? '' : 'i');
    } catch (err) {
      return { content: `Error: invalid regex — ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }

    try {
      const backend = getExecutionBackend();
      const matches: string[] = [];
      const deadlineMs = Date.now() + getSearchTimeoutMs();
      await searchPath(backend, userPath, regex, matches, deadlineMs);

      if (matches.length === 0) return { content: 'No matches found.' };
      const header = matches.length >= MAX_RESULTS ? `(first ${MAX_RESULTS} matches)\n` : '';
      return { content: header + matches.join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
