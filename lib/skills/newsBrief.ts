import { type SkillDefinition } from '../skill';
import { techNews } from './techNews';

export const newsBrief: SkillDefinition = {
  ...techNews,
  name: 'newsBrief',
  description:
    'Alias for techNews — fetches news from multiple topics. Use techNews directly with the topics parameter for multi-topic digests.',
};
