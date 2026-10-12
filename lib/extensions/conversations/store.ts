/**
 * Conversation history persistence.
 *
 * Stores per-session conversation histories on disk so that they survive
 * CopHarness restarts.  Each history is keyed by an arbitrary string
 * (LINE userId, Discord channelId, etc.) and stored in a single JSON file.
 *
 * The file is shared by every CopHarness process (server, CLI, bots): reads are
 * served from an in-memory copy that is refreshed when the file changes, and
 * each write is a locked read-modify-write cycle so concurrent processes never
 * overwrite each other's sessions.
 *
 * The file path can be overridden with the CONVERSATION_HISTORY_FILE
 * environment variable (default: ./conversation_history.json).
 *
 * Maximum number of session entries kept is controlled by MAX_SESSIONS
 * (default: 1000).  Entries least-recently-updated are evicted first.
 */

import * as path from 'path';
import type { LLMMessage } from '../../core/adapter';
import { dataPath } from '../../core/utils/dataDir';
import { createSharedJsonStore } from '../../core/utils/sharedJsonStore';
import { indexConversationMessages } from '../memory/search/index';

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

// ── Shared store ─────────────────────────────────────────────────────────────

function parseHistory(parsed: unknown): HistoryStore {
  const store: HistoryStore = {};
  // Support legacy format (plain Record<string, LLMMessage[]>) transparently
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        // Legacy: bare message array
        store[k] = { messages: v as LLMMessage[], updatedAt: 0 };
      } else if (v && typeof v === 'object' && Array.isArray((v as HistoryEntry).messages)) {
        store[k] = v as HistoryEntry;
      }
    }
  }
  return store;
}

/**
 * Reads follow the file on disk (so several processes see each other's sessions); writes are locked
 * read-modify-write cycles, serialised in-process and across processes.
 */
const sharedStore = createSharedJsonStore<HistoryStore>({
  file: historyFilePath,
  parse: parseHistory,
});

function getStore(): HistoryStore {
  return sharedStore.read();
}

function evictOldest(store: HistoryStore): void {
  const keys = Object.keys(store);
  if (keys.length <= MAX_SESSIONS) return;
  // Evict least-recently-updated entries
  const sorted = [...keys].sort((a, b) => (store[a]?.updatedAt ?? 0) - (store[b]?.updatedAt ?? 0));
  for (const k of sorted.slice(0, keys.length - MAX_SESSIONS)) delete store[k];
}

/** Locked read-modify-write; a failed write is logged, not thrown (history must never break a chat). */
async function persistUpdate<R>(mutate: (store: HistoryStore) => R): Promise<R | undefined> {
  try {
    return await sharedStore.update((store) => {
      const result = mutate(store);
      evictOldest(store);
      return result;
    });
  } catch (err) {
    console.warn('[history/store] Failed to write conversation_history.json:', err);
    return undefined;
  }
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
  const previousCount = await persistUpdate((store) => {
    const count = store[key]?.messages.length ?? 0;
    store[key] = { messages: history, updatedAt: Date.now() };
    return count;
  });
  // Index only new non-system messages — failure must never affect save behaviour
  if (previousCount !== undefined) indexConversationMessages(key, history, previousCount);
}

/**
 * Remove the stored conversation history for the given session key.
 */
export async function clearHistory(key: string): Promise<void> {
  await persistUpdate((store) => {
    delete store[key];
  });
}

/**
 * List all stored conversation sessions sorted by most-recently-updated first.
 */
export function listHistoryKeys(): { key: string; messageCount: number; updatedAt: number }[] {
  const store = getStore();
  return Object.entries(store)
    .map(([key, entry]) => ({
      key,
      messageCount: entry.messages.length,
      updatedAt: entry.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
