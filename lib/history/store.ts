/**
 * Conversation history persistence.
 *
 * Stores per-session conversation histories on disk so that they survive
 * CopHarness restarts.  Each history is keyed by an arbitrary string
 * (LINE userId, Discord channelId, etc.) and stored in a single JSON file.
 *
 * The file path can be overridden with the CONVERSATION_HISTORY_FILE
 * environment variable (default: ./conversation_history.json).
 *
 * Maximum number of session entries kept in the file is controlled by
 * MAX_SESSIONS (default: 1000).
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { LLMMessage } from '../adapter';

/** Maximum number of distinct sessions stored on disk. */
const MAX_SESSIONS = 1000;

function historyFilePath(): string {
  return path.resolve(
    process.cwd(),
    process.env.CONVERSATION_HISTORY_FILE ?? 'conversation_history.json',
  );
}

type HistoryStore = Record<string, LLMMessage[]>;

function loadStore(): HistoryStore {
  const filePath = historyFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistoryStore;
  } catch {
    return {};
  }
}

async function saveStore(store: HistoryStore): Promise<void> {
  // Evict oldest entries if we exceed MAX_SESSIONS
  const keys = Object.keys(store);
  if (keys.length > MAX_SESSIONS) {
    const evict = keys.slice(0, keys.length - MAX_SESSIONS);
    for (const k of evict) delete store[k];
  }
  await fsp.writeFile(historyFilePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

/**
 * Load the stored conversation history for the given session key.
 * Returns an empty array if no history exists yet.
 */
export function loadHistory(key: string): LLMMessage[] {
  const store = loadStore();
  return store[key] ? [...store[key]] : [];
}

/**
 * Persist the conversation history for the given session key.
 * Pass an empty array to effectively clear the history.
 */
export async function saveHistory(key: string, history: LLMMessage[]): Promise<void> {
  const store = loadStore();
  store[key] = history;
  await saveStore(store);
}

/**
 * Remove the stored conversation history for the given session key.
 */
export async function clearHistory(key: string): Promise<void> {
  const store = loadStore();
  delete store[key];
  await saveStore(store);
}
