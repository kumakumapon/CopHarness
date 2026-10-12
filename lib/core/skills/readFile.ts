import { type SkillDefinition } from '../skill';
import { getExecutionBackend } from '../execution';

/** Maximum characters returned by readFile to avoid flooding the context. */
const MAX_READ_BYTES = 100_000;

export const readFile: SkillDefinition = {
  name: 'readFile',
  description:
    'Reads the content of a file from the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace) ' +
    'via the configured execution backend. ' +
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
      const backend = getExecutionBackend();
      const result = await backend.readFile({ relativePath: userPath, maxBytes: MAX_READ_BYTES });
      if (result.truncated) {
        return { content: result.content + '\n[truncated]' };
      }
      return { content: result.content };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
