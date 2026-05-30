import { validateSkillOutput } from '../../lib/guardrails/outputValidator';
import { recordViolation, listViolations, violationCount } from '../../lib/guardrails/violationLog';

// ---------------------------------------------------------------------------
// outputValidator
// ---------------------------------------------------------------------------

describe('validateSkillOutput – type: string', () => {
  test('passes when content meets minLength', () => {
    const r = validateSkillOutput('2024-01-15T12:00:00.000Z', { type: 'string', minLength: 20 });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  test('fails when content is shorter than minLength', () => {
    const r = validateSkillOutput('hi', { type: 'string', minLength: 10 });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/minLength/);
  });

  test('passes when content matches pattern', () => {
    const r = validateSkillOutput('2024-01-15T00:00:00Z', {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T',
    });
    expect(r.valid).toBe(true);
  });

  test('fails when content does not match pattern', () => {
    const r = validateSkillOutput('not-a-date', {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T',
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/pattern/);
  });

  test('fails when maxLength exceeded', () => {
    const r = validateSkillOutput('hello world', { type: 'string', maxLength: 5 });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/maxLength/);
  });
});

describe('validateSkillOutput – type: number', () => {
  test('passes for valid integer string', () => {
    const r = validateSkillOutput('42', { type: 'number' });
    expect(r.valid).toBe(true);
  });

  test('passes for valid float string', () => {
    const r = validateSkillOutput('3.14159', { type: 'number' });
    expect(r.valid).toBe(true);
  });

  test('fails for non-numeric string', () => {
    const r = validateSkillOutput('not-a-number', { type: 'number' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/not a valid number/);
  });

  test('passes for NaN literal (valid JS number representation)', () => {
    const r = validateSkillOutput('NaN', { type: 'number' });
    expect(r.valid).toBe(true);
  });
});

describe('validateSkillOutput – type: object', () => {
  test('passes valid JSON object with required fields', () => {
    const r = validateSkillOutput(
      JSON.stringify({ name: 'Tokyo', temp: 20 }),
      { type: 'object', required: ['name', 'temp'] },
    );
    expect(r.valid).toBe(true);
  });

  test('fails when required field is missing', () => {
    const r = validateSkillOutput(
      JSON.stringify({ name: 'Tokyo' }),
      { type: 'object', required: ['name', 'temp'] },
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/temp/);
  });

  test('fails for non-JSON content', () => {
    const r = validateSkillOutput('plain text', { type: 'object' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/JSON/);
  });

  test('fails when value is a JSON array not object', () => {
    const r = validateSkillOutput('[1,2,3]', { type: 'object' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/array/);
  });

  test('reports property type mismatch', () => {
    const r = validateSkillOutput(
      JSON.stringify({ count: 'five' }),
      {
        type: 'object',
        properties: { count: { type: 'number', description: '' } },
      },
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/count/);
  });
});

describe('validateSkillOutput – type: array', () => {
  test('passes valid JSON array', () => {
    const r = validateSkillOutput('[1, 2, 3]', { type: 'array' });
    expect(r.valid).toBe(true);
  });

  test('fails for non-array JSON', () => {
    const r = validateSkillOutput('{"a":1}', { type: 'array' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/array/);
  });
});

// ---------------------------------------------------------------------------
// violationLog (in-memory only; file writes are async & non-critical)
// ---------------------------------------------------------------------------

describe('violationLog', () => {
  test('recordViolation adds to buffer and listViolations returns it newest-first', () => {
    const before = listViolations(200);
    const beforeCount = violationCount();

    recordViolation('testSkill', ['field "x" missing'], '{"y": 1}');

    const after = listViolations(200);
    expect(after.length).toBe(before.length + 1);
    expect(after[0].skillName).toBe('testSkill');
    expect(after[0].errors).toContain('field "x" missing');
    expect(violationCount()).toBe(beforeCount + 1);
  });

  test('contentPreview is truncated to 200 chars', () => {
    const longContent = 'x'.repeat(500);
    recordViolation('previewTest', ['error'], longContent);
    const violations = listViolations(200);
    const found = violations.find((v) => v.skillName === 'previewTest');
    expect(found).toBeDefined();
    expect(found!.contentPreview.length).toBeLessThanOrEqual(200);
  });
});
