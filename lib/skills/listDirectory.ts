import fs from 'node:fs/promises';
import path from 'node:path';
import { type SkillDefinition } from '../skill';
import { resolveSafe, getSandboxDir } from './fileSandbox';

interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export const listDirectory: SkillDefinition = {
  name: 'listDirectory',
  description:
    'Lists files and directories inside the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace). ' +
    'Use "." or leave path empty for the sandbox root.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the directory inside the sandbox. Defaults to "." (sandbox root).',
      },
    },
  },
  category: 'file',
  riskLevel: 'low',
  handler: async (args) => {
    const userPath = String(args.path ?? '.').trim() || '.';
    try {
      let resolved: string;
      if (userPath === '.') {
        resolved = await getSandboxDir();
      } else {
        resolved = await resolveSafe(userPath);
      }
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) return { content: `Error: "${userPath}" is not a directory`, isError: true };
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const result: DirEntry[] = await Promise.all(
        entries.map(async (e) => {
          const entry: DirEntry = {
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
          };
          if (e.isFile()) {
            try {
              const s = await fs.stat(path.join(resolved, e.name));
              entry.size = s.size;
            } catch {
              // ignore
            }
          }
          return entry;
        }),
      );
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      if (result.length === 0) return { content: '(empty directory)' };
      const lines = result.map((e) => {
        const prefix = e.type === 'directory' ? '📁 ' : '📄 ';
        const size = e.size !== undefined ? ` (${e.size} bytes)` : '';
        return `${prefix}${e.name}${size}`;
      });
      return { content: lines.join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
