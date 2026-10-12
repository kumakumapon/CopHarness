/**
 * Persistent log of skill output schema violations.
 * Backed by a JSON file shared across processes: reads follow the file, and each new violation is
 * appended under the cross-process lock (a violation is a rare event, so the blocking write is fine
 * and keeps `recordViolation` synchronous for its callers).
 */

import { dataPath } from '../utils/dataDir';
import { createSharedJsonStore } from '../utils/sharedJsonStore';

export interface SchemaViolation {
  id: string;
  skillName: string;
  timestamp: string;
  errors: string[];
  /** First 200 chars of the invalid content for debugging. */
  contentPreview: string;
}

const MAX_VIOLATIONS = 200;

function storePath(): string {
  return dataPath('schema_violations.json');
}

const sharedLog = createSharedJsonStore<SchemaViolation[]>({
  file: storePath,
  parse: (raw) => (Array.isArray(raw) ? (raw as SchemaViolation[]).slice(-MAX_VIOLATIONS) : []),
});

/** Record a new schema violation. Never throws: a log failure must not affect the skill call. */
export function recordViolation(
  skillName: string,
  errors: string[],
  content: string,
): void {
  const violation: SchemaViolation = {
    id: crypto.randomUUID(),
    skillName,
    timestamp: new Date().toISOString(),
    errors,
    contentPreview: content.slice(0, 200),
  };
  try {
    sharedLog.updateSync((log) => {
      log.push(violation);
      if (log.length > MAX_VIOLATIONS) log.splice(0, log.length - MAX_VIOLATIONS);
    });
  } catch (err) {
    console.warn('[violationLog] Failed to persist schema violation:', err);
  }
}

/** Return the most recent `limit` violations, newest first. */
export function listViolations(limit = 50): SchemaViolation[] {
  return sharedLog.read().slice().reverse().slice(0, Math.min(limit, MAX_VIOLATIONS));
}

/** Number of violations currently stored (capped at MAX_VIOLATIONS). */
export function violationCount(): number {
  return sharedLog.read().length;
}
