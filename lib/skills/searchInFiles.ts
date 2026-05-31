import fs from 'node:fs/promises';
import path from 'node:path';
import { type SkillDefinition } from '../skill';
import { getSandboxDir } from './fileSandbox';

const MAX_RESULTS = 200;
const MAX_FILE_SIZE_BYTES = 1_000_000;

/** Recursively collect all files under a directory. */
async function collectFiles(dir: string, results: string[] = []): Promise<string[]> {
  if (results.length >= MAX_RESULTS) return results;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export const searchInFiles: SkillDefinition = {
  name: 'searchInFiles',
  description:
    'Searches for a text pattern in files within the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace). ' +
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
      const sandboxDir = await getSandboxDir();
      let searchRoot: string;
      if (userPath === '.') {
        searchRoot = sandboxDir;
      } else {
        // Resolve relative to sandbox, reject traversal
        const stripped = userPath.replace(/^[/\\]+/, '');
        const resolved = path.resolve(sandboxDir, stripped);
        if (!resolved.startsWith(sandboxDir + path.sep) && resolved !== sandboxDir) {
          return { content: `Error: path "${userPath}" is outside the sandbox directory.`, isError: true };
        }
        searchRoot = resolved;
      }

      const stat = await fs.stat(searchRoot).catch(() => null);
      if (!stat) return { content: `Error: path "${userPath}" does not exist`, isError: true };

      const files = stat.isFile() ? [searchRoot] : await collectFiles(searchRoot);
      const matches: string[] = [];

      for (const file of files) {
        if (matches.length >= MAX_RESULTS) break;
        const fileStat = await fs.stat(file).catch(() => null);
        if (!fileStat || fileStat.size > MAX_FILE_SIZE_BYTES) continue;
        let content: string;
        try { content = await fs.readFile(file, 'utf8'); } catch { continue; }
        const relPath = path.relative(sandboxDir, file);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= MAX_RESULTS) break;
          if (regex.test(lines[i])) {
            matches.push(`${relPath}:${i + 1}: ${lines[i]}`);
          }
        }
      }

      if (matches.length === 0) return { content: 'No matches found.' };
      const header = matches.length >= MAX_RESULTS ? `(first ${MAX_RESULTS} matches)\n` : '';
      return { content: header + matches.join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
