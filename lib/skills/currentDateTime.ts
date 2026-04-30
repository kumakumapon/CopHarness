import { type SkillDefinition } from '../skill';

/** Built-in skill: returns the current date and time in ISO 8601 format. */
export const currentDateTime: SkillDefinition = {
  name: 'currentDateTime',
  description: 'Returns the current date and time in ISO 8601 format.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (_args) => {
    return { content: new Date().toISOString() };
  },
};
