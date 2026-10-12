import { type SkillDefinition } from '../skill';
import { getExecutionBackend } from '../execution';

export const listDirectory: SkillDefinition = {
  name: 'listDirectory',
  description:
    'Lists files and directories inside the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace) ' +
    'via the configured execution backend. ' +
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
      const backend = getExecutionBackend();
      const result = await backend.listDir({ relativePath: userPath });
      const entries = result.entries;
      if (entries.length === 0) return { content: '(empty directory)' };
      const lines = entries.map((e) => {
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
