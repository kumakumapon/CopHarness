import type { SkillDefinition } from '../../core/skill';
import { proposeSkill } from './proposeSkill';

/** Skills this extension contributes, in registration order. */
export const builtinSkills: SkillDefinition[] = [proposeSkill];
