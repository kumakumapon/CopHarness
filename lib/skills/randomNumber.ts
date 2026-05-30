import { type SkillDefinition } from '../skill';

export const randomNumber: SkillDefinition = {
  name: 'randomNumber',
  description: 'Generates a random number within the specified range (inclusive). If integer is true, returns an integer.',
  parameters: {
    type: 'object',
    properties: {
      min: { type: 'number', description: 'Minimum value (inclusive). Defaults to 0.' },
      max: { type: 'number', description: 'Maximum value (inclusive). Defaults to 1.' },
      integer: { type: 'boolean', description: 'If true, returns a random integer. Defaults to false.' },
    },
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const min = typeof args.min === 'number' ? args.min : 0;
    const max = typeof args.max === 'number' ? args.max : 1;
    const integer = args.integer === true;
    if (min > max) {
      return { content: 'Error: min must be less than or equal to max', isError: true };
    }
    if (integer) {
      const result = Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
      return { content: String(result) };
    }
    const result = Math.random() * (max - min) + min;
    return { content: String(result) };
  },
};
