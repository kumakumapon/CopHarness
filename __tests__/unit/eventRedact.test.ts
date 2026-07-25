import { redactBusEvent } from '../../lib/events/redact';
import type { BusEvent, SkillStartPayload } from '../../lib/events/bus';

function makeSkillStartEvent(args: Record<string, unknown>): BusEvent<SkillStartPayload> {
  return {
    type: 'skill:start',
    timestamp: '2026-07-25T00:00:00.000Z',
    payload: {
      skillName: 'writeFile',
      args,
      taskId: 'task-1',
    },
  };
}

describe('redactBusEvent', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to redacting secret-bearing args when DASHBOARD_EVENTS_SKILL_ARGS is unset', () => {
    delete process.env.DASHBOARD_EVENTS_SKILL_ARGS;
    const event = makeSkillStartEvent({ apiKey: 'sk-abcdefghijklmnopqrstuv', path: 'notes.md' });

    const result = redactBusEvent(event) as BusEvent<SkillStartPayload>;

    expect(result.payload.args).toMatchObject({ apiKey: '[REDACTED]', path: 'notes.md' });
  });

  it('omits args and yields sorted argKeys when set to "omit"', () => {
    process.env.DASHBOARD_EVENTS_SKILL_ARGS = 'omit';
    const event = makeSkillStartEvent({ zeta: 1, alpha: 2, apiKey: 'sk-abcdefghijklmnopqrstuv' });

    const result = redactBusEvent(event) as BusEvent<SkillStartPayload>;

    expect(result.payload.args).toBeUndefined();
    expect(result.payload.argKeys).toEqual(['alpha', 'apiKey', 'zeta']);
  });

  it('passes args through untouched when set to "raw"', () => {
    process.env.DASHBOARD_EVENTS_SKILL_ARGS = 'raw';
    const args = { apiKey: 'sk-abcdefghijklmnopqrstuv', path: 'notes.md' };
    const event = makeSkillStartEvent(args);

    const result = redactBusEvent(event) as BusEvent<SkillStartPayload>;

    expect(result.payload.args).toEqual(args);
  });

  it('falls back to redacted behaviour for an unrecognised value', () => {
    process.env.DASHBOARD_EVENTS_SKILL_ARGS = 'somethingElse';
    const event = makeSkillStartEvent({ apiKey: 'sk-abcdefghijklmnopqrstuv', path: 'notes.md' });

    const result = redactBusEvent(event) as BusEvent<SkillStartPayload>;

    expect(result.payload.args).toMatchObject({ apiKey: '[REDACTED]', path: 'notes.md' });
  });

  it('does not mutate the input event', () => {
    delete process.env.DASHBOARD_EVENTS_SKILL_ARGS;
    const event = makeSkillStartEvent({ apiKey: 'sk-abcdefghijklmnopqrstuv', path: 'notes.md' });
    const snapshot = JSON.parse(JSON.stringify(event));

    redactBusEvent(event);

    expect(event).toEqual(snapshot);
  });

  it('masks inline secrets in string payload fields for non-skill:start events', () => {
    const event: BusEvent = {
      type: 'system:error',
      timestamp: '2026-07-25T00:00:00.000Z',
      payload: {
        source: 'adapter',
        error: 'request failed: Authorization: Bearer sk-abcdefghijklmnopqrstuv',
        fatal: false,
      },
    };

    const result = redactBusEvent(event) as BusEvent<{ source: string; error: string; fatal: boolean }>;

    expect(result.payload.error).not.toContain('sk-abcdefghijklmnopqrstuv');
    expect(result.payload.source).toBe('adapter');
  });
});
