/**
 * Redaction for events leaving the process via the dashboard SSE/history
 * endpoints (`app/api/dashboard/events/route.ts`). Skill arguments in
 * particular can carry file contents, URLs, and webhook destinations, so
 * they get special handling before the generic preview redaction runs over
 * the rest of the payload.
 */

import type { BusEvent, SkillStartPayload } from './bus';
import { redactPreviewValue } from '../toolPolicy/redaction';

type SkillArgsMode = 'redacted' | 'omit' | 'raw';

/**
 * Resolve the `DASHBOARD_EVENTS_SKILL_ARGS` operator setting. Unset or
 * unrecognised values fall back to the safe default (`redacted`).
 */
function resolveSkillArgsMode(): SkillArgsMode {
  const raw = process.env.DASHBOARD_EVENTS_SKILL_ARGS;
  if (raw === 'omit' || raw === 'raw') return raw;
  return 'redacted';
}

/**
 * Redact a single bus event for external consumption. Never mutates the
 * input event; always returns a new object.
 */
export function redactBusEvent(event: BusEvent): BusEvent {
  if (event.type !== 'skill:start') {
    return {
      type: event.type,
      timestamp: event.timestamp,
      payload: redactPreviewValue(event.payload),
    };
  }

  const skillPayload = event.payload as SkillStartPayload;
  const mode = resolveSkillArgsMode();

  let workingPayload: SkillStartPayload;
  if (mode === 'omit') {
    const { args, ...rest } = skillPayload;
    workingPayload = {
      ...rest,
      argKeys: Object.keys(args ?? {}).sort(),
    } as SkillStartPayload;
  } else {
    // 'redacted' and 'raw' both start from the full payload; 'raw' restores
    // the untouched args after the generic pass below.
    workingPayload = { ...skillPayload };
  }

  const redactedPayload = redactPreviewValue(workingPayload) as SkillStartPayload;

  if (mode === 'raw') {
    // Explicit operator opt-in: skip redaction of args entirely.
    redactedPayload.args = skillPayload.args;
  }

  return {
    type: event.type,
    timestamp: event.timestamp,
    payload: redactedPayload,
  };
}
