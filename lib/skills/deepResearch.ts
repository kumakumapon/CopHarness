import { type SkillDefinition } from '../skill';
import { freeResearch } from './freeResearch';

export const deepResearch: SkillDefinition = {
  ...freeResearch,
  name: 'deepResearch',
  description:
    'Alias for freeResearch — performs deep, multi-angle research on a topic using ' +
    'DuckDuckGo and Wikipedia. Supports sub-queries and multiple Wikipedia language editions. ' +
    'No API key required.',
};
