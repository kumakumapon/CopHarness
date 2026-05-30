/**
 * Skill (tool/function calling) abstraction layer.
 * Defines the interfaces for declaring and executing skills that LLM adapters
 * can expose to the model as callable tools.
 */

import { validateSkillOutput } from './guardrails/outputValidator';
import { recordViolation } from './guardrails/violationLog';

/** A single property definition within a skill's parameter schema. */
export interface SkillParameterProperty {
  type: string;
  description?: string;
  /** Allowed values (for enum-like string parameters). */
  enum?: string[];
  /** Item schema for array-type parameters. */
  items?: { type: string; description?: string };
  /** Minimum value for numeric parameters. */
  minimum?: number;
  /** Maximum value for numeric parameters. */
  maximum?: number;
}

export interface SkillParameterSchema {
  type: 'object';
  properties: Record<string, SkillParameterProperty>;
  required?: string[];
}

/** Risk classification for a skill. */
export type SkillRiskLevel = 'low' | 'medium' | 'high';

/**
 * JSON Schema subset for validating a skill's output content.
 * When attached to a SkillDefinition, the harness validates every
 * non-error SkillResult against this schema and records violations.
 */
export interface SkillOutputSchema {
  type: 'string' | 'number' | 'object' | 'array';
  /** Minimum string length (only for type 'string'). */
  minLength?: number;
  /** Maximum string length (only for type 'string'). */
  maxLength?: number;
  /** Regex pattern the string content must match (only for type 'string'). */
  pattern?: string;
  /** Required keys (only for type 'object'). */
  required?: string[];
  /** Property type constraints (only for type 'object'). */
  properties?: Record<string, SkillParameterProperty>;
  /** Item schema for type 'array'. */
  items?: { type: string; description?: string };
}

/** Functional grouping for a skill. */
export type SkillCategory =
  | 'utility'
  | 'file'
  | 'web'
  | 'system'
  | 'memory'
  | 'external';

export interface SkillDefinition {
  name: string;
  description: string;
  parameters: SkillParameterSchema;
  handler: (args: Record<string, unknown>) => Promise<SkillResult>;
  /** Functional category used for grouping in the dashboard. */
  category?: SkillCategory;
  /** Environment variable names required for this skill to function. */
  requiresEnv?: string[];
  /** Risk level: low = read-only / side-effect free, medium = writes local state, high = executes code / calls external APIs with side effects. */
  riskLevel?: SkillRiskLevel;
  /**
   * Optional schema describing the expected format of a successful SkillResult.content.
   * When set, the harness validates every non-error output against this schema and
   * records any violations in the schema violation log.
   */
  outputSchema?: SkillOutputSchema;
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
  if (skill.outputSchema) {
    const schema = skill.outputSchema;
    const originalHandler = skill.handler;
    skill = {
      ...skill,
      handler: async (args) => {
        const result = await originalHandler(args);
        if (!result.isError) {
          const validation = validateSkillOutput(result.content, schema);
          if (!validation.valid) {
            recordViolation(skill.name, validation.errors, result.content);
          }
        }
        return result;
      },
    };
  }
  skillRegistry.set(skill.name, skill);
}

/** Look up a registered skill by name. Returns undefined if not found. */
export function getSkill(name: string): SkillDefinition | undefined {
  return skillRegistry.get(name);
}

/**
 * Return the definitions for a list of skill names, silently ignoring unknown names.
 * If the ENABLED_SKILLS environment variable is set (comma-separated list of skill names),
 * only skills in that list are returned even if they were requested.
 */
export function resolveSkills(names: string[]): SkillDefinition[] {
  const enabledSet = buildEnabledSet();
  return names.flatMap((name) => {
    if (enabledSet && !enabledSet.has(name)) return [];
    const skill = skillRegistry.get(name);
    return skill ? [skill] : [];
  });
}

/** Return all registered skill definitions. */
export function listSkills(): SkillDefinition[] {
  return Array.from(skillRegistry.values());
}

/**
 * Return registered skills that are currently active.
 * When ENABLED_SKILLS is set, only skills in that list are returned.
 * When unset, all registered skills are returned.
 */
export function listActiveSkills(): SkillDefinition[] {
  const enabledSet = buildEnabledSet();
  if (!enabledSet) return listSkills();
  return listSkills().filter((s) => enabledSet.has(s.name));
}

/** Build the set of allowed skill names from ENABLED_SKILLS env var, or null if unrestricted. */
function buildEnabledSet(): Set<string> | null {
  const env = process.env.ENABLED_SKILLS;
  if (!env || env.trim() === '') return null;
  return new Set(env.split(',').map((s) => s.trim()).filter(Boolean));
}
