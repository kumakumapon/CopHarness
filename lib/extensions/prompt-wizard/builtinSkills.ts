import type { SkillDefinition } from '../../core/skill';
import { listPromptTemplates, buildPromptFromTemplate } from './promptWizard';

/** Skills this extension contributes, in registration order. */
export const builtinSkills: SkillDefinition[] = [listPromptTemplates, buildPromptFromTemplate];
