/**
 * Lightweight JSON Schema validator for skill output content.
 * Validates the string content returned by a SkillResult against
 * an SkillOutputSchema definition.
 */

import type { SkillOutputSchema, SkillParameterProperty } from '../skill';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a single value against a SkillParameterProperty type constraint. */
function checkType(value: unknown, prop: SkillParameterProperty, fieldPath: string): string[] {
  const errors: string[] = [];
  const actual = Array.isArray(value) ? 'array' : typeof value;

  if (prop.type && actual !== prop.type) {
    errors.push(`"${fieldPath}": expected ${prop.type}, got ${actual}`);
    return errors;
  }
  if (prop.enum && !prop.enum.includes(String(value))) {
    errors.push(`"${fieldPath}": value "${String(value)}" not in enum [${prop.enum.join(', ')}]`);
  }
  if (prop.minimum !== undefined && typeof value === 'number' && value < prop.minimum) {
    errors.push(`"${fieldPath}": ${value} < minimum ${prop.minimum}`);
  }
  if (prop.maximum !== undefined && typeof value === 'number' && value > prop.maximum) {
    errors.push(`"${fieldPath}": ${value} > maximum ${prop.maximum}`);
  }
  return errors;
}

/**
 * Validate the raw string content of a SkillResult against an SkillOutputSchema.
 *
 * - type 'string'  → validates the raw string directly (pattern, minLength, maxLength)
 * - type 'number'  → validates the string is parseable as a finite number
 * - type 'object'  → parses as JSON, checks required fields and property types
 * - type 'array'   → parses as JSON, checks it is an array
 */
export function validateSkillOutput(content: string, schema: SkillOutputSchema): ValidationResult {
  const errors: string[] = [];

  switch (schema.type) {
    case 'string': {
      if (schema.minLength !== undefined && content.length < schema.minLength) {
        errors.push(`Content length ${content.length} < minLength ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && content.length > schema.maxLength) {
        errors.push(`Content length ${content.length} > maxLength ${schema.maxLength}`);
      }
      if (schema.pattern) {
        try {
          if (!new RegExp(schema.pattern).test(content)) {
            errors.push(`Content does not match pattern /${schema.pattern}/`);
          }
        } catch {
          errors.push(`Invalid pattern in outputSchema: "${schema.pattern}"`);
        }
      }
      break;
    }

    case 'number': {
      const trimmed = content.trim();
      const num = Number(trimmed);
      if (trimmed === '' || (isNaN(num) && trimmed !== 'NaN' && trimmed !== 'Infinity' && trimmed !== '-Infinity')) {
        errors.push(`Content "${content.slice(0, 60)}" is not a valid number`);
      }
      break;
    }

    case 'object':
    case 'array': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        errors.push(`Content is not valid JSON (expected ${schema.type})`);
        break;
      }

      if (schema.type === 'array') {
        if (!Array.isArray(parsed)) {
          errors.push(`Expected JSON array, got ${typeof parsed}`);
        } else if (schema.items && parsed.length > 0) {
          const item = parsed[0];
          const itemType = Array.isArray(item) ? 'array' : typeof item;
          if (schema.items.type && itemType !== schema.items.type) {
            errors.push(`Array items: expected ${schema.items.type}, got ${itemType}`);
          }
        }
        break;
      }

      // type === 'object'
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        errors.push(`Expected JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
        break;
      }

      const obj = parsed as Record<string, unknown>;

      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in obj)) {
            errors.push(`Missing required field: "${field}"`);
          }
        }
      }

      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            errors.push(...checkType(obj[key], propSchema, key));
          }
        }
      }
      break;
    }

    default:
      errors.push(`Unknown schema type: "${(schema as { type: string }).type}"`);
  }

  return { valid: errors.length === 0, errors };
}
