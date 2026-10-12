import type { SkillDefinition } from '../../core/skill';
import { memoryUpsert, memorySearch, memoryForget, memoryExplain } from './skills/memory';
import { searchHistory } from './skills/searchHistory';

/** Skills this extension contributes, in registration order. */
export const builtinSkills: SkillDefinition[] = [memoryUpsert, memorySearch, memoryForget, memoryExplain, searchHistory];
