import fs from 'node:fs/promises';
import { type SkillDefinition } from '../skill';
import { resolveSafe } from './fileSandbox';

/** Maximum characters returned by readFile to avoid flooding the context. */
const MAX_READ_BYTES = 100_000;

export const readFile: SkillDefinition = {
  name: 'readFile',
  description:
    'Reads the content of a file from the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace). ' +
    'Returns up to 100 000 characters. Use relative paths only.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file inside the sandbox, e.g. "notes.txt" or "subdir/data.json".',
      },
    },
    required: ['path'],
  },
  category: 'file',
  riskLevel: 'medium',
  handler: async (args) => {
    const userPath = String(args.path ?? '').trim();
    if (!userPath) return { content: 'Error: path is required', isError: true };
    try {
      const resolved = await resolveSafe(userPath);
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) return { content: `Error: "${userPath}" is not a file`, isError: true };
      const content = await fs.readFile(resolved, 'utf8');
      if (content.length > MAX_READ_BYTES) {
        return { content: content.slice(0, MAX_READ_BYTES) + '\n[truncated]' };
      }
      return { content };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
