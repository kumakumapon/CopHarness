/**
 * Composition root: registers every skill the harness ships with.
 *
 * lib/core must not know about extensions, so the wiring lives here. Entry points (API routes, CLI,
 * bots) import this module for its side effects instead of lib/core/skills/index.ts.
 */

import './core/skills/index';
import { registerSkillSet } from './core/skills/registerSkillSet';
import { builtinSkills as skillPackSkills } from './extensions/skill-packs/builtinSkills';
import { builtinSkills as memorySkills } from './extensions/memory/builtinSkills';
import { builtinSkills as promptWizardSkills } from './extensions/prompt-wizard/builtinSkills';
import { builtinSkills as agentSkills } from './extensions/agents/builtinSkills';
import { builtinSkills as skillProposalSkills } from './extensions/skill-proposals/builtinSkills';
import { registerGeneratedSkills } from './extensions/skill-proposals/generated';

registerSkillSet(skillPackSkills);
registerSkillSet(memorySkills);
registerSkillSet(promptWizardSkills);
registerSkillSet(agentSkills);
registerSkillSet(skillProposalSkills);

// Register approved generated skills after the built-ins so the collision check sees them.
try {
  registerGeneratedSkills();
} catch (err) {
  console.error('[skills] Failed to register generated skills:', err instanceof Error ? err.message : err);
}
