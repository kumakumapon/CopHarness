/**
 * Persistent log of skill output schema violations.
 * Mirrors the pattern used in lib/logs/store.ts:
 * - in-memory circular buffer for fast reads during the current process
 * - JSON file for persistence across restarts
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { dataPath } from '../utils/dataDir';

export interface SchemaViolation {
  id: string;
  skillName: string;
  timestamp: string;
  errors: string[];
  /** First 200 chars of the invalid content for debugging. */
  contentPreview: string;
}

const MAX_VIOLATIONS = 200;

/** In-process ring buffer — populated at startup from file and updated on each violation. */
const buffer: SchemaViolation[] = [];
let bufferLoaded = false;

function storePath(): string {
  return dataPath('schema_violations.json');
}

function loadFromFile(): SchemaViolation[] {
  const p = storePath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as SchemaViolation[];
  } catch {
    return [];
  }
}

function ensureBuffer(): void {
  if (bufferLoaded) return;
  const stored = loadFromFile();
  buffer.push(...stored.slice(-MAX_VIOLATIONS));
  bufferLoaded = true;
}

async function persist(): Promise<void> {
  const toWrite = buffer.slice(-MAX_VIOLATIONS);
  try {
    await fsp.writeFile(storePath(), JSON.stringify(toWrite, null, 2) + '\n', 'utf-8');
  } catch {
    // Non-critical — do not throw; violations are still in memory
  }
}

/**
 * Record a new schema violation.
 * Fire-and-forget from the caller's perspective (the async write is non-blocking).
 */
export function recordViolation(
  skillName: string,
  errors: string[],
  content: string,
): void {
  ensureBuffer();
  const violation: SchemaViolation = {
    id: crypto.randomUUID(),
    skillName,
    timestamp: new Date().toISOString(),
    errors,
    contentPreview: content.slice(0, 200),
  };
  buffer.push(violation);
  if (buffer.length > MAX_VIOLATIONS) buffer.shift();
  void persist();
}

/** Return the most recent `limit` violations, newest first. */
export function listViolations(limit = 50): SchemaViolation[] {
  ensureBuffer();
  return buffer.slice().reverse().slice(0, Math.min(limit, MAX_VIOLATIONS));
}

/** Total violation count since the process started (or since last restart). */
export function violationCount(): number {
  ensureBuffer();
  return buffer.length;
}
