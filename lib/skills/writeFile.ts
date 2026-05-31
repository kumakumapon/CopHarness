import fs from 'node:fs/promises';
import path from 'node:path';
import { type SkillDefinition } from '../skill';
import { resolveSafe } from './fileSandbox';

export const writeFile: SkillDefinition = {
  name: 'writeFile',
  description:
    'Writes text content to a file inside the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace). ' +
    'Creates the file and any missing parent directories. Use relative paths only.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file inside the sandbox, e.g. "output.txt" or "results/data.json".',
      },
      content: {
        type: 'string',
        description: 'Text content to write to the file.',
      },
      append: {
        type: 'boolean',
        description: 'If true, appends to an existing file instead of overwriting. Defaults to false.',
      },
    },
    required: ['path', 'content'],
  },
  category: 'file',
  riskLevel: 'medium',
  handler: async (args) => {
    const userPath = String(args.path ?? '').trim();
    const content = String(args.content ?? '');
    const append = args.append === true;
    if (!userPath) return { content: 'Error: path is required', isError: true };
    try {
      const resolved = await resolveSafe(userPath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      if (append) {
        await fs.appendFile(resolved, content, 'utf8');
      } else {
        await fs.writeFile(resolved, content, 'utf8');
      }
      return { content: `Successfully ${append ? 'appended to' : 'wrote'} "${userPath}" (${content.length} characters).` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
