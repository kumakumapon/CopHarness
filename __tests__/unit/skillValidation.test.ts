/**
 * Unit tests for the validateSkillArgs function in lib/skill.ts.
 * Covers required-param checks, type validation (string/number/integer/boolean/array),
 * enum validation, multiple errors, unknown parameters, and empty schemas.
 */

jest.mock('../../lib/guardrails/outputValidator', () => ({
  validateSkillOutput: jest.fn().mockReturnValue({ valid: true, errors: [] }),
}));
jest.mock('../../lib/guardrails/violationLog', () => ({
  recordViolation: jest.fn(),
}));
jest.mock('../../lib/skills/executionLog', () => ({
  recordSkillExecution: jest.fn().mockResolvedValue({ id: 'exec-1' }),
}));
jest.mock('../../lib/skills/executionContext', () => ({
  getSkillExecutionContext: jest.fn().mockReturnValue(undefined),
}));
jest.mock('../../lib/telemetry/tracer', () => ({
  startSpan: jest.fn().mockReturnValue({ end: jest.fn() }),
}));

import { validateSkillArgs, type SkillParameterSchema } from '../../lib/skill';

// ---------------------------------------------------------------------------
// 1. Required parameters
// ---------------------------------------------------------------------------

describe('validateSkillArgs – required parameters', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A name' },
      age: { type: 'number', description: 'An age' },
    },
    required: ['name', 'age'],
  };

  it('returns an error when a required parameter is missing (undefined)', () => {
    const errors = validateSkillArgs({ age: 30 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Missing required parameter.*"name"/);
  });

  it('returns an error when a required parameter is null', () => {
    const errors = validateSkillArgs({ name: null as unknown as string, age: 30 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Missing required parameter.*"name"/);
  });

  it('returns no errors when all required parameters are present', () => {
    const errors = validateSkillArgs({ name: 'Alice', age: 25 }, schema);
    expect(errors).toHaveLength(0);
  });

  it('returns errors for every missing required parameter', () => {
    const errors = validateSkillArgs({}, schema);
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes('"name"'))).toBe(true);
    expect(errors.some((e) => e.includes('"age"'))).toBe(true);
  });

  it('does not error for optional parameters that are missing', () => {
    const optionalSchema: SkillParameterSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string' },
      },
      required: ['name'],
    };
    const errors = validateSkillArgs({ name: 'Bob' }, optionalSchema);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Type validation – string
// ---------------------------------------------------------------------------

describe('validateSkillArgs – type: string', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      label: { type: 'string' },
    },
  };

  it('passes when value is a string', () => {
    const errors = validateSkillArgs({ label: 'hello' }, schema);
    expect(errors).toHaveLength(0);
  });

  it('returns an error when a number is passed for a string parameter', () => {
    const errors = validateSkillArgs({ label: 42 as unknown as string }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Parameter "label" must be a string, got number/);
  });

  it('returns an error when a boolean is passed for a string parameter', () => {
    const errors = validateSkillArgs({ label: true as unknown as string }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be a string/);
  });
});

// ---------------------------------------------------------------------------
// 3. Type validation – number
// ---------------------------------------------------------------------------

describe('validateSkillArgs – type: number', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      score: { type: 'number', minimum: 0, maximum: 100 },
    },
  };

  it('passes for a valid number within range', () => {
    const errors = validateSkillArgs({ score: 55.5 }, schema);
    expect(errors).toHaveLength(0);
  });

  it('passes for boundary values (minimum and maximum)', () => {
    expect(validateSkillArgs({ score: 0 }, schema)).toHaveLength(0);
    expect(validateSkillArgs({ score: 100 }, schema)).toHaveLength(0);
  });

  it('returns an error for a non-number value', () => {
    const errors = validateSkillArgs({ score: 'high' as unknown as number }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be a number, got string/);
  });

  it('returns an error when value is below minimum', () => {
    const errors = validateSkillArgs({ score: -1 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be >= 0/);
  });

  it('returns an error when value is above maximum', () => {
    const errors = validateSkillArgs({ score: 101 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be <= 100/);
  });
});

// ---------------------------------------------------------------------------
// 4. Type validation – integer
// ---------------------------------------------------------------------------

describe('validateSkillArgs – type: integer', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      count: { type: 'integer' },
    },
  };

  it('passes for a whole-number integer value', () => {
    const errors = validateSkillArgs({ count: 7 }, schema);
    expect(errors).toHaveLength(0);
  });

  it('returns an error for a float value', () => {
    const errors = validateSkillArgs({ count: 3.14 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be an integer, got 3\.14/);
  });

  it('returns an error for a non-number value', () => {
    const errors = validateSkillArgs({ count: 'five' as unknown as number }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be a number, got string/);
  });
});

// ---------------------------------------------------------------------------
// 5. Type validation – boolean
// ---------------------------------------------------------------------------

describe('validateSkillArgs – type: boolean', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
    },
  };

  it('passes for a true boolean value', () => {
    expect(validateSkillArgs({ enabled: true }, schema)).toHaveLength(0);
  });

  it('passes for a false boolean value', () => {
    expect(validateSkillArgs({ enabled: false }, schema)).toHaveLength(0);
  });

  it('returns an error when a string is passed for a boolean parameter', () => {
    const errors = validateSkillArgs({ enabled: 'yes' as unknown as boolean }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be a boolean, got string/);
  });

  it('returns an error when a number is passed for a boolean parameter', () => {
    const errors = validateSkillArgs({ enabled: 1 as unknown as boolean }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be a boolean, got number/);
  });
});

// ---------------------------------------------------------------------------
// 6. Type validation – array
// ---------------------------------------------------------------------------

describe('validateSkillArgs – type: array', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  it('passes for a valid string array', () => {
    const errors = validateSkillArgs({ tags: ['a', 'b', 'c'] }, schema);
    expect(errors).toHaveLength(0);
  });

  it('passes for an empty array', () => {
    const errors = validateSkillArgs({ tags: [] }, schema);
    expect(errors).toHaveLength(0);
  });

  it('returns an error when a non-array value is passed', () => {
    const errors = validateSkillArgs({ tags: 'not-an-array' as unknown as string[] }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be an array, got string/);
  });

  it('validates item types and returns an error for wrong-typed items', () => {
    const errors = validateSkillArgs({ tags: ['good', 42, 'also-good'] as unknown as string[] }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/tags\[1\].*must be string, got number/);
  });

  it('reports the correct index for each item type error', () => {
    const errors = validateSkillArgs({ tags: [1, 2, 'ok'] as unknown as string[] }, schema);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/tags\[0\]/);
    expect(errors[1]).toMatch(/tags\[1\]/);
  });

  it('passes for arrays without items constraint', () => {
    const schemaNoItems: SkillParameterSchema = {
      type: 'object',
      properties: {
        data: { type: 'array' },
      },
    };
    const errors = validateSkillArgs({ data: [1, 'two', true] }, schemaNoItems);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Enum validation
// ---------------------------------------------------------------------------

describe('validateSkillArgs – enum validation', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      color: { type: 'string', enum: ['red', 'green', 'blue'] },
    },
  };

  it('passes when value is in the allowed enum list', () => {
    expect(validateSkillArgs({ color: 'red' }, schema)).toHaveLength(0);
    expect(validateSkillArgs({ color: 'green' }, schema)).toHaveLength(0);
    expect(validateSkillArgs({ color: 'blue' }, schema)).toHaveLength(0);
  });

  it('returns an error when value is not in enum', () => {
    const errors = validateSkillArgs({ color: 'purple' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be one of \[red, green, blue\]/);
  });

  it('includes the rejected value in the error message', () => {
    const errors = validateSkillArgs({ color: 'yellow' }, schema);
    expect(errors[0]).toMatch(/got "yellow"/);
  });

  it('lists all allowed values in the error message', () => {
    const errors = validateSkillArgs({ color: 'pink' }, schema);
    expect(errors[0]).toContain('red');
    expect(errors[0]).toContain('green');
    expect(errors[0]).toContain('blue');
  });
});

// ---------------------------------------------------------------------------
// 8. Multiple errors
// ---------------------------------------------------------------------------

describe('validateSkillArgs – multiple errors', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number', minimum: 0 },
      active: { type: 'boolean' },
    },
    required: ['name', 'age', 'active'],
  };

  it('returns multiple errors when multiple validations fail', () => {
    const errors = validateSkillArgs(
      {
        name: 123 as unknown as string,
        age: -5,
        active: 'yes' as unknown as boolean,
      },
      schema,
    );
    // Wrong type for name, below minimum for age, wrong type for active
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.some((e) => e.includes('"name"') && e.includes('string'))).toBe(true);
    expect(errors.some((e) => e.includes('"age"') && e.includes('>= 0'))).toBe(true);
    expect(errors.some((e) => e.includes('"active"') && e.includes('boolean'))).toBe(true);
  });

  it('accumulates missing-required and type errors together', () => {
    // name is missing (required), age has wrong type
    const errors = validateSkillArgs(
      { age: 'thirty' as unknown as number, active: true },
      schema,
    );
    expect(errors.some((e) => e.includes('Missing required parameter') && e.includes('"name"'))).toBe(true);
    expect(errors.some((e) => e.includes('"age"') && e.includes('must be a number'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Unknown parameters
// ---------------------------------------------------------------------------

describe('validateSkillArgs – unknown parameters are ignored', () => {
  const schema: SkillParameterSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
  };

  it('does not error when extra parameters not in schema are present', () => {
    const errors = validateSkillArgs(
      { name: 'Alice', extraField: 'unexpected', anotherExtra: 99 },
      schema,
    );
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Empty schema
// ---------------------------------------------------------------------------

describe('validateSkillArgs – empty schema', () => {
  it('always passes when properties is empty and required is absent', () => {
    const schema: SkillParameterSchema = {
      type: 'object',
      properties: {},
    };
    expect(validateSkillArgs({}, schema)).toHaveLength(0);
    expect(validateSkillArgs({ anything: 'value' }, schema)).toHaveLength(0);
  });

  it('always passes when required is an empty array', () => {
    const schema: SkillParameterSchema = {
      type: 'object',
      properties: {},
      required: [],
    };
    expect(validateSkillArgs({}, schema)).toHaveLength(0);
  });
});
