import type { SkillDefinition } from '../../core/skill';
import { spawnAgent } from './spawnAgent';

/** Skills this extension contributes, in registration order. */
export const builtinSkills: SkillDefinition[] = [spawnAgent];
