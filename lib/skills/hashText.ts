import { createHash } from 'node:crypto';
import { type SkillDefinition } from '../skill';

const ALGORITHMS = ['sha256', 'sha512', 'sha1', 'md5'] as const;
type Algorithm = typeof ALGORITHMS[number];

export const hashText: SkillDefinition = {
  name: 'hashText',
  description:
    'Computes a cryptographic hash of the given text and returns it as a hex string. ' +
    `Supported algorithms: ${ALGORITHMS.join(', ')}.`,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to hash.',
      },
      algorithm: {
        type: 'string',
        description: `Hash algorithm to use. Supported: ${ALGORITHMS.join(', ')}. Defaults to "sha256".`,
        enum: [...ALGORITHMS],
      },
    },
    required: ['text'],
  },
  category: 'utility',
  riskLevel: 'low',
  outputSchema: {
    type: 'string',
    minLength: 32,
    pattern: '^[0-9a-f]+$',
  },
  handler: async (args) => {
    const text = String(args.text ?? '');
    const algorithm = String(args.algorithm ?? 'sha256').toLowerCase() as Algorithm;
    if (!(ALGORITHMS as readonly string[]).includes(algorithm)) {
      return {
        content: `Error: unsupported algorithm "${algorithm}". Supported: ${ALGORITHMS.join(', ')}`,
        isError: true,
      };
    }
    try {
      const hash = createHash(algorithm).update(text, 'utf8').digest('hex');
      return { content: hash };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
