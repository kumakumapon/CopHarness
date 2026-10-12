import { registerSkill, type SkillDefinition } from '../skill';
import { applyGatesToRegistry } from '../humanInLoop/gate';

/**
 * Register a group of built-in skills (core or an extension's), applying the human-in-the-loop gate
 * to each one first. Registration order is the order of the array.
 */
export function registerSkillSet(skills: SkillDefinition[]): void {
  for (const skill of applyGatesToRegistry(skills)) {
    registerSkill(skill);
  }
}
