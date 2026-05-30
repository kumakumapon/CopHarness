import { randomUUID } from 'node:crypto';
import { type SkillDefinition } from '../skill';

export const uuidGenerate: SkillDefinition = {
  name: 'uuidGenerate',
  description: 'Generates one or more UUID v4 values.',
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of UUIDs to generate (1–100). Defaults to 1.',
        minimum: 1,
        maximum: 100,
      },
    },
  },
  category: 'utility',
  riskLevel: 'low',
  outputSchema: {
    type: 'string',
    minLength: 36,
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',
  },
  handler: async (args) => {
    const count = typeof args.count === 'number' ? Math.min(100, Math.max(1, Math.floor(args.count))) : 1;
    const uuids = Array.from({ length: count }, () => randomUUID());
    return { content: uuids.join('\n') };
  },
};
