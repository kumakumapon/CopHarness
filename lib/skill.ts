/**
 * Skill (tool/function calling) abstraction layer.
 * Defines the interfaces for declaring and executing skills that LLM adapters
 * can expose to the model as callable tools.
 */

import { validateSkillOutput } from './guardrails/outputValidator';
import { recordViolation } from './guardrails/violationLog';
import { recordSkillExecution } from './skills/executionLog';
import { getSkillExecutionContext } from './skills/executionContext';
import { startSpan } from './telemetry/tracer';

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
  const originalHandler = skill.handler;
  const schema = skill.outputSchema;

  skill.handler = async (args) => {
    const startedAt = new Date();
    const startMs = Date.now();
    const initialContext = getSkillExecutionContext();
    const span = startSpan('skill.execute', {
      'skill.name': skill.name,
      'skill.risk_level': skill.riskLevel ?? 'low',
      ...(initialContext?.personId ? { 'person.id': initialContext.personId } : {}),
      ...(initialContext?.channelKey ? { 'channel.key': initialContext.channelKey } : {}),
      ...(initialContext?.taskId ? { 'task.id': initialContext.taskId } : {}),
      ...(initialContext?.approvalId ? { 'approval.id': initialContext.approvalId } : {}),
      'policy.decision': initialContext?.policyDecision ?? 'allowed',
    });

    try {
      const result = await originalHandler(args);
      if (schema && !result.isError) {
        const validation = validateSkillOutput(result.content, schema);
        if (!validation.valid) {
          recordViolation(skill.name, validation.errors, result.content);
        }
      }
      const finishedAt = new Date();
      const context = getSkillExecutionContext();
      const executionRecord = await recordSkillExecution({
        skillName: skill.name,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startMs,
        status: result.isError ? 'error' : 'success',
        args,
        resultContent: result.content,
        error: result.isError ? result.content : undefined,
        personId: context?.personId,
        channelKey: context?.channelKey,
        taskId: context?.taskId,
        approvalId: context?.approvalId,
      });
      span.end({
        'skill.execution.id': executionRecord.id,
        'skill.status': result.isError ? 'error' : 'success',
        'skill.result.length': result.content.length,
        ...(context?.personId ? { 'person.id': context.personId } : {}),
        ...(context?.channelKey ? { 'channel.key': context.channelKey } : {}),
        ...(context?.taskId ? { 'task.id': context.taskId } : {}),
        ...(context?.approvalId ? { 'approval.id': context.approvalId } : {}),
        ...(context?.approvalStatus ? { 'approval.status': context.approvalStatus } : {}),
        'policy.decision': context?.policyDecision ?? (context?.approvalId ? (result.isError ? 'approval_rejected' : 'approval_approved') : 'allowed'),
      });
      return result;
    } catch (error) {
      const finishedAt = new Date();
      const context = getSkillExecutionContext();
      const executionRecord = await recordSkillExecution({
        skillName: skill.name,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startMs,
        status: 'exception',
        args,
        error,
        personId: context?.personId,
        channelKey: context?.channelKey,
        taskId: context?.taskId,
        approvalId: context?.approvalId,
      });
      span.end({
        'skill.execution.id': executionRecord.id,
        'skill.status': 'exception',
        ...(context?.personId ? { 'person.id': context.personId } : {}),
        ...(context?.channelKey ? { 'channel.key': context.channelKey } : {}),
        ...(context?.taskId ? { 'task.id': context.taskId } : {}),
        ...(context?.approvalId ? { 'approval.id': context.approvalId } : {}),
        ...(context?.approvalStatus ? { 'approval.status': context.approvalStatus } : {}),
        'policy.decision': context?.policyDecision ?? (context?.approvalId ? 'approval_exception' : 'allowed'),
      }, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };

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
 * When unset, only low-risk skills can be resolved implicitly.
 */
export function resolveSkills(names: string[]): SkillDefinition[] {
  const enabledSet = buildEnabledSet();
  return names.flatMap((name) => {
    const skill = skillRegistry.get(name);
    if (!skill) return [];
    if (enabledSet) return enabledSet.has(name) ? [skill] : [];
    if ((skill.riskLevel ?? 'low') !== 'low') return [];
    return [skill];
  });
}

/** Return all registered skill definitions. */
export function listSkills(): SkillDefinition[] {
  return Array.from(skillRegistry.values());
}

/**
 * Return registered skills that are currently active.
 * When ENABLED_SKILLS is set, only skills in that list are returned.
 * When unset, only low-risk skills are returned by default.
 */
export function listActiveSkills(): SkillDefinition[] {
  const enabledSet = buildEnabledSet();
  if (!enabledSet) return listSkills().filter((s) => (s.riskLevel ?? 'low') === 'low');
  return listSkills().filter((s) => enabledSet.has(s.name));
}

/** Build the set of allowed skill names from ENABLED_SKILLS env var, or null if unrestricted. */
function buildEnabledSet(): Set<string> | null {
  const env = process.env.ENABLED_SKILLS;
  if (!env || env.trim() === '') return null;
  return new Set(env.split(',').map((s) => s.trim()).filter(Boolean));
}
