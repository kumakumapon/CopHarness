import { type SkillDefinition } from '../skill';

export const base64Encode: SkillDefinition = {
  name: 'base64Encode',
  description: 'Encodes a UTF-8 string to Base64.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The string to encode.' },
    },
    required: ['text'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const text = String(args.text ?? '');
    const encoded = Buffer.from(text, 'utf8').toString('base64');
    return { content: encoded };
  },
};

export const base64Decode: SkillDefinition = {
  name: 'base64Decode',
  description: 'Decodes a Base64 string to UTF-8 text.',
  parameters: {
    type: 'object',
    properties: {
      encoded: { type: 'string', description: 'The Base64-encoded string to decode.' },
    },
    required: ['encoded'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const encoded = String(args.encoded ?? '');
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      return { content: decoded };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
