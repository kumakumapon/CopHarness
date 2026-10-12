/**
 * Transcript logger.
 *
 * Appends per-session conversation events to JSONL files under
 * `<DATA_DIR>/transcripts/<YYYY-MM-DD>/<sessionKey>.jsonl`.
 *
 * Inspired by xangi's logPrompt() / logResponse() / logError() pattern:
 *   https://github.com/karaage0703/xangi/blob/main/src/local-llm/runner.ts
 *
 * Logging is best-effort: errors are swallowed and only logged to stderr.
 *
 * Enable by setting TRANSCRIPT_LOGGING=true in the environment.
 * Disabled by default to avoid filling disk for users who do not need it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { dataPath } from '../utils/dataDir';

type EventType = 'prompt' | 'response' | 'error';

interface TranscriptEntry {
  ts: string;   // ISO 8601 timestamp
  type: EventType;
  sessionKey: string;
  data: unknown;
}

/** Return true when transcript logging is enabled via env var. */
function isEnabled(): boolean {
  return (process.env.TRANSCRIPT_LOGGING ?? '').toLowerCase() === 'true';
}

/** YYYY-MM-DD for the current date (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Sanitise a session key so it is safe to use as a file name. */
function safeKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_:\-]/g, '_').slice(0, 128);
}

function append(sessionKey: string, entry: TranscriptEntry): void {
  if (!isEnabled()) return;
  try {
    const filePath = dataPath('transcripts', todayUtc(), `${safeKey(sessionKey)}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error('[transcriptLogger] Failed to write transcript entry:', err);
  }
}

/** Log a user prompt. */
export function logPrompt(sessionKey: string, prompt: string): void {
  append(sessionKey, {
    ts: new Date().toISOString(),
    type: 'prompt',
    sessionKey,
    data: { prompt },
  });
}

/** Log an LLM response. */
export function logResponse(sessionKey: string, response: string): void {
  append(sessionKey, {
    ts: new Date().toISOString(),
    type: 'response',
    sessionKey,
    data: { response },
  });
}

/** Log an error that occurred during an LLM call. */
export function logError(sessionKey: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  append(sessionKey, {
    ts: new Date().toISOString(),
    type: 'error',
    sessionKey,
    data: { error: message },
  });
}
