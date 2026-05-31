import { type SkillDefinition } from '../skill';

export const jsonFormat: SkillDefinition = {
  name: 'jsonFormat',
  description: 'Parses and pretty-prints a JSON string with the specified indentation.',
  parameters: {
    type: 'object',
    properties: {
      json: { type: 'string', description: 'The JSON string to format.' },
      indent: {
        type: 'number',
        description: 'Number of spaces for indentation (1–8). Defaults to 2.',
        minimum: 1,
        maximum: 8,
      },
    },
    required: ['json'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const input = String(args.json ?? '');
    const indent = typeof args.indent === 'number' ? Math.min(8, Math.max(1, Math.floor(args.indent))) : 2;
    try {
      const parsed: unknown = JSON.parse(input);
      return { content: JSON.stringify(parsed, null, indent) };
    } catch (err) {
      return { content: `Error: invalid JSON — ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
