/**
 * Audit logger.
 *
 * Appends JSONL entries to `logs/audit.jsonl` (relative to project root).
 * Override the path via the `AUDIT_LOG_PATH` environment variable.
 *
 * Logging is best-effort: errors are swallowed and only written to stderr so
 * that a broken filesystem never takes down the API.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuditEventType = 'request' | 'response' | 'skill_call' | 'approval' | 'error';

export interface AuditEntry {
  ts: string;               // ISO 8601 timestamp
  event: AuditEventType;
  taskId?: string;
  personId?: string;
  channelKey?: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveLogPath(): string {
  return process.env.AUDIT_LOG_PATH ?? path.join(process.cwd(), 'logs', 'audit.jsonl');
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Core export
// ---------------------------------------------------------------------------

/**
 * Append a single audit entry to the JSONL log file.
 * All errors are swallowed — the caller should never have to handle them.
 */
export function auditLog(entry: Omit<AuditEntry, 'ts'> & { ts?: string }): void {
  try {
    const logPath = resolveLogPath();
    ensureDir(logPath);
    const record: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.error('[auditLogger] Failed to write audit entry:', err);
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Log an incoming LLM request (user prompt). */
export function auditRequest(
  taskId: string | undefined,
  personId: string | undefined,
  prompt: unknown,
): void {
  auditLog({
    event: 'request',
    taskId,
    personId,
    data: { prompt },
  });
}

/** Log an outgoing LLM response. */
export function auditResponse(
  taskId: string | undefined,
  reply: unknown,
): void {
  auditLog({
    event: 'response',
    taskId,
    data: { reply },
  });
}

/** Log a skill (tool) invocation and its result. */
export function auditSkillCall(
  taskId: string | undefined,
  skillName: string,
  args: unknown,
  result: unknown,
  error?: unknown,
): void {
  auditLog({
    event: 'skill_call',
    taskId,
    data: {
      skillName,
      args,
      result,
      ...(error !== undefined
        ? { error: error instanceof Error ? error.message : String(error) }
        : {}),
    },
  });
}

/** Log an error that occurred during task processing. */
export function auditError(
  taskId: string | undefined,
  error: unknown,
): void {
  auditLog({
    event: 'error',
    taskId,
    data: {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
}
