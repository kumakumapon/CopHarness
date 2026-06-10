/**
 * Conversation history persistence.
 *
 * Stores per-session conversation histories on disk so that they survive
 * CopHarness restarts.  Each history is keyed by an arbitrary string
 * (LINE userId, Discord channelId, etc.) and stored in a single JSON file.
 *
 * The file is loaded once into memory on first access.  All subsequent reads
 * come from the in-memory store, and writes are flushed to disk sequentially
 * to avoid concurrent write races.
 *
 * The file path can be overridden with the CONVERSATION_HISTORY_FILE
 * environment variable (default: ./conversation_history.json).
 *
 * Maximum number of session entries kept is controlled by MAX_SESSIONS
 * (default: 1000).  Entries least-recently-updated are evicted first.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { LLMMessage } from '../adapter';
import { dataPath } from '../utils/dataDir';
import { indexConversationMessages } from '../search/index';

/** Maximum number of distinct sessions stored. */
const MAX_SESSIONS = 1000;

function historyFilePath(): string {
  // Explicit CONVERSATION_HISTORY_FILE always takes precedence (legacy compat).
  const explicit = process.env.CONVERSATION_HISTORY_FILE;
  if (explicit) return path.resolve(explicit);
  // Otherwise place it under DATA_DIR (or cwd when DATA_DIR is unset).
  return dataPath('conversation_history.json');
}

/** On-disk format: messages + last-updated timestamp for LRU eviction. */
interface HistoryEntry {
  messages: LLMMessage[];
  updatedAt: number; // epoch ms
}

type HistoryStore = Record<string, HistoryEntry>;

// ── Singleton in-memory store ────────────────────────────────────────────────

let _store: HistoryStore | null = null;

/** Load the store from disk once; all subsequent reads use the in-memory copy. */
function getStore(): HistoryStore {
  if (_store !== null) return _store;
  const filePath = historyFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
      // Support legacy format (plain Record<string, LLMMessage[]>) transparently
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const migrated: HistoryStore = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (Array.isArray(v)) {
            // Legacy: bare message array
            migrated[k] = { messages: v as LLMMessage[], updatedAt: 0 };
          } else if (v && typeof v === 'object' && Array.isArray((v as HistoryEntry).messages)) {
            migrated[k] = v as HistoryEntry;
          }
        }
        _store = migrated;
      } else {
        _store = {};
      }
    } catch {
      _store = {};
    }
  } else {
    _store = {};
  }
  return _store;
}

// ── Serialized disk writes ───────────────────────────────────────────────────

/** Chain of pending write operations – ensures writes are sequential. */
let _writeQueue: Promise<void> = Promise.resolve();

function scheduleWrite(): void {
  _writeQueue = _writeQueue.then(async () => {
    const store = getStore();
    const keys = Object.keys(store);
    if (keys.length > MAX_SESSIONS) {
      // Evict least-recently-updated entries
      const sorted = [...keys].sort((a, b) => (store[a]?.updatedAt ?? 0) - (store[b]?.updatedAt ?? 0));
      const evict = sorted.slice(0, keys.length - MAX_SESSIONS);
      for (const k of evict) delete store[k];
    }
    try {
      await fsp.writeFile(historyFilePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8');
    } catch (err) {
      console.warn('[history/store] Failed to write conversation_history.json:', err);
    }
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the stored conversation history for the given session key.
 * Returns an empty array if no history exists yet.
 */
export function loadHistory(key: string): LLMMessage[] {
  const entry = getStore()[key];
  return entry ? [...entry.messages] : [];
}

/**
 * Persist the conversation history for the given session key.
 * The write is queued and executed asynchronously; awaiting the returned
 * promise ensures the data has been flushed to disk.
 */
export async function saveHistory(key: string, history: LLMMessage[]): Promise<void> {
  const previousCount = getStore()[key]?.messages.length ?? 0;
  getStore()[key] = { messages: history, updatedAt: Date.now() };
  scheduleWrite();
  // Index only new non-system messages — failure must never affect save behaviour
  indexConversationMessages(key, history, previousCount);
  return _writeQueue;
}

/**
 * Remove the stored conversation history for the given session key.
 */
export async function clearHistory(key: string): Promise<void> {
  const store = getStore();
  delete store[key];
  scheduleWrite();
  return _writeQueue;
}
