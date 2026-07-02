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
import { eventBus } from './events/bus';

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
  | 'external'
  | 'generated';

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
  /** Optional non-mutating preview used by tool policy dry-runs and approval UI. */
  dryRun?: (args: Record<string, unknown>) => Promise<SkillDryRunPreview>;
}

export interface SkillDryRunPreview {
  summary: string;
  details?: Record<string, unknown>;
  diff?: string;
  command?: string;
  targets?: string[];
  externalDestinations?: string[];
  riskAttributes?: string[];
  unavailableReason?: string;
}

export interface SkillResult {
  content: string;
  isError?: boolean;
}

/** Maximum number of tool-call iterations per completion to prevent infinite loops. */
export const MAX_SKILL_ITERATIONS = 10;

/** Registry mapping skill names to their definitions. */
const skillRegistry = new Map<string, SkillDefinition>();

/**
 * Validate skill arguments against the parameter schema.
 * Returns an array of human-readable error strings (empty = valid).
 */
export function validateSkillArgs(
  args: Record<string, unknown>,
  schema: SkillParameterSchema,
): string[] {
  const errors: string[] = [];

  for (const name of schema.required ?? []) {
    if (args[name] === undefined || args[name] === null) {
      errors.push(`Missing required parameter: "${name}"`);
    }
  }

  for (const [name, value] of Object.entries(args)) {
    const prop = schema.properties[name];
    if (!prop) continue;
    if (value === undefined || value === null) continue;

    const expectedType = prop.type;
    if (expectedType === 'string') {
      if (typeof value !== 'string') {
        errors.push(`Parameter "${name}" must be a string, got ${typeof value}`);
      }
    } else if (expectedType === 'number' || expectedType === 'integer') {
      if (typeof value !== 'number') {
        errors.push(`Parameter "${name}" must be a number, got ${typeof value}`);
      } else {
        if (prop.minimum !== undefined && value < prop.minimum) {
          errors.push(`Parameter "${name}" must be >= ${prop.minimum}, got ${value}`);
        }
        if (prop.maximum !== undefined && value > prop.maximum) {
          errors.push(`Parameter "${name}" must be <= ${prop.maximum}, got ${value}`);
        }
        if (expectedType === 'integer' && !Number.isInteger(value)) {
          errors.push(`Parameter "${name}" must be an integer, got ${value}`);
        }
      }
    } else if (expectedType === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push(`Parameter "${name}" must be a boolean, got ${typeof value}`);
      }
    } else if (expectedType === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`Parameter "${name}" must be an array, got ${typeof value}`);
      } else if (prop.items?.type) {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] !== prop.items.type) {
            errors.push(`Parameter "${name}[${i}]" must be ${prop.items.type}, got ${typeof value[i]}`);
          }
        }
      }
    }

    if (prop.enum && prop.enum.length > 0 && typeof value === 'string') {
      if (!prop.enum.includes(value)) {
        errors.push(`Parameter "${name}" must be one of [${prop.enum.join(', ')}], got "${value}"`);
      }
    }
  }

  return errors;
}

/** Register a skill so it can be looked up by name. */
export function registerSkill(skill: SkillDefinition): void {
  if (skillRegistry.has(skill.name)) {
    console.warn(`[skill] Overwriting existing skill: "${skill.name}"`);
  }

  const originalHandler = skill.handler;
  const schema = skill.outputSchema;

  skill.handler = async (args) => {
    const validationErrors = validateSkillArgs(args, skill.parameters);
    if (validationErrors.length > 0) {
      return {
        content: `Invalid arguments for skill "${skill.name}": ${validationErrors.join('; ')}`,
        isError: true,
      };
    }
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

    eventBus.emit('skill:start', {
      skillName: skill.name,
      args,
      taskId: initialContext?.taskId,
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
      const durationMs = Date.now() - startMs;
      eventBus.emit('skill:end', {
        skillName: skill.name,
        durationMs,
        resultLength: result.content.length,
        isError: result.isError ?? false,
        taskId: context?.taskId,
      });
      const executionRecord = await recordSkillExecution({
        skillName: skill.name,
        startedAt,
        finishedAt,
        durationMs,
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
      const exDurationMs = Date.now() - startMs;
      const errMsg = error instanceof Error ? error.message : String(error);
      eventBus.emit('skill:error', {
        skillName: skill.name,
        error: errMsg,
        durationMs: exDurationMs,
        taskId: getSkillExecutionContext()?.taskId,
      });
      const finishedAt = new Date();
      const context = getSkillExecutionContext();
      const executionRecord = await recordSkillExecution({
        skillName: skill.name,
        startedAt,
        finishedAt,
        durationMs: exDurationMs,
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
