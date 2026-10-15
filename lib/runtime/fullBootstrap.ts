import { registerSkillSet } from '../core/skills/registerSkillSet';
import { builtinSkills as skillPackSkills } from '../extensions/skill-packs/builtinSkills';
import { builtinSkills as memorySkills } from '../extensions/memory/builtinSkills';
import { builtinSkills as promptWizardSkills } from '../extensions/prompt-wizard/builtinSkills';
import { builtinSkills as agentSkills } from '../extensions/agents/builtinSkills';
import { builtinSkills as skillProposalSkills } from '../extensions/skill-proposals/builtinSkills';
import { registerGeneratedSkills } from '../extensions/skill-proposals/generated';

export function registerExtensions(): void {
  for (const skills of [skillPackSkills, memorySkills, promptWizardSkills, agentSkills, skillProposalSkills]) registerSkillSet(skills);
  registerGeneratedSkills();
}
