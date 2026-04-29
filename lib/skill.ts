/**
 * Skill (tool/function calling) abstraction layer.
 * Defines the interfaces for declaring and executing skills that LLM adapters
 * can expose to the model as callable tools.
 */

export interface SkillParameterSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export interface SkillDefinition {
  name: string;
  description: string;
  parameters: SkillParameterSchema;
  handler: (args: Record<string, unknown>) => Promise<SkillResult>;
}

export interface SkillResult {
  content: string;
  isError?: boolean;
}

/** Maximum number of tool-call iterations per completion to prevent infinite loops. */
export const MAX_SKILL_ITERATIONS = 10;

/** Registry mapping skill names to their definitions. */
const skillRegistry = new Map<string, SkillDefinition>();

/** Register a skill so it can be looked up by name. */
export function registerSkill(skill: SkillDefinition): void {
  skillRegistry.set(skill.name, skill);
}

/** Look up a registered skill by name. Returns undefined if not found. */
export function getSkill(name: string): SkillDefinition | undefined {
  return skillRegistry.get(name);
}

/** Return the definitions for a list of skill names, silently ignoring unknown names. */
export function resolveSkills(names: string[]): SkillDefinition[] {
  return names.flatMap((name) => {
    const skill = skillRegistry.get(name);
    return skill ? [skill] : [];
  });
}
