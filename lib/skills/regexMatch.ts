import { type SkillDefinition } from '../skill';

export const regexMatch: SkillDefinition = {
  name: 'regexMatch',
  description:
    'Tests a regular expression against a string and returns all matches. ' +
    'Supports flags (e.g., "i" for case-insensitive, "m" for multiline, "s" for dotAll).',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to search in.',
      },
      pattern: {
        type: 'string',
        description: 'Regular expression pattern (without surrounding slashes).',
      },
      flags: {
        type: 'string',
        description: 'Regex flags (e.g., "i", "m", "gi"). "g" is always applied. Defaults to "g".',
      },
    },
    required: ['text', 'pattern'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const text = String(args.text ?? '');
    const pattern = String(args.pattern ?? '');
    if (!pattern) return { content: 'Error: pattern is required', isError: true };

    // Ensure 'g' flag is present so exec iterates all matches
    const rawFlags = String(args.flags ?? 'g').toLowerCase();
    const flags = rawFlags.includes('g') ? rawFlags : rawFlags + 'g';

    try {
      const regex = new RegExp(pattern, flags);
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        matches.push(match[0]);
        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) regex.lastIndex++;
      }
      if (matches.length === 0) return { content: 'No matches found.' };
      return {
        content: `${matches.length} match(es):\n${matches.map((m, i) => `${i + 1}. ${JSON.stringify(m)}`).join('\n')}`,
      };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
