/**
 * Memory Nudge — Phase 2 feature.
 *
 * When a user message contains something worth remembering, the bot appends
 * a nudge asking if it should be saved. The user's next short reply persists
 * or discards the candidate.
 *
 * Feature is OFF unless `MEMORY_NUDGE_ENABLED=true|1`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { dataPath } from '../utils/dataDir';
import { MemoryStore, type MemoryKind } from './store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryNudgeCandidate {
  kind: MemoryKind;
  content: string;
}

export interface PendingMemoryNudge extends MemoryNudgeCandidate {
  conversationKey: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Internal store types
// ---------------------------------------------------------------------------

type NudgeStoreFile = Record<string, PendingMemoryNudge>;

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

export function isMemoryNudgeEnabled(): boolean {
  const val = process.env.MEMORY_NUDGE_ENABLED;
  return val === 'true' || val === '1';
}

// ---------------------------------------------------------------------------
// Detection heuristics
// ---------------------------------------------------------------------------

interface HeuristicRule {
  pattern: RegExp;
  kind: MemoryKind;
  normalize: (match: RegExpMatchArray, original: string) => string;
}

const HEURISTIC_RULES: HeuristicRule[] = [
  // Explicit remember requests (Japanese)
  {
    pattern: /覚えて(おいて)?[ください]*/,
    kind: 'fact',
    normalize: (_match, original) => original.replace(/覚えておいて[ください]*|覚えて[ください]*/, '').trim(),
  },
  // Explicit remember requests (English)
  {
    pattern: /^remember (that )?/i,
    kind: 'fact',
    normalize: (match, original) => original.slice(match[0].length).trim(),
  },
  // Self-introduction (Japanese)
  {
    pattern: /(私|僕|俺)の名前は(.+)/,
    kind: 'fact',
    normalize: (_match, original) => original.trim(),
  },
  // Self-introduction (English)
  {
    pattern: /my name is (.+)/i,
    kind: 'fact',
    normalize: (_match, original) => original.trim(),
  },
  // Preferences (Japanese)
  {
    pattern: /(.+)(が好き|が嫌い|が苦手|を使ってい(る|ます))/,
    kind: 'preference',
    normalize: (_match, original) => original.trim(),
  },
  // Preferences (English)
  {
    pattern: /I (like|love|hate|prefer) (.+)/i,
    kind: 'preference',
    normalize: (_match, original) => original.trim(),
  },
  // Birthday / personal dates (Japanese)
  {
    pattern: /誕生日は(.+)/,
    kind: 'fact',
    normalize: (_match, original) => original.trim(),
  },
];

/**
 * Pure heuristic detection.
 * Returns null for questions and texts longer than 200 chars.
 */
export function detectMemoryCandidate(text: string): MemoryNudgeCandidate | null {
  const trimmed = text.trim();

  // Reject questions
  if (trimmed.endsWith('?') || trimmed.endsWith('？')) return null;

  // Reject very long texts
  if (trimmed.length > 200) return null;

  for (const rule of HEURISTIC_RULES) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      const content = rule.normalize(match, trimmed);
      if (content) {
        return { kind: rule.kind, content };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pending-nudge store
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function nudgeFilePath(): string {
  const explicit = process.env.MEMORY_NUDGE_FILE;
  if (explicit) return path.resolve(explicit);
  return dataPath('memory_nudges.json');
}

function getTtlMs(): number {
  const raw = process.env.MEMORY_NUDGE_TTL_MS;
  if (raw) {
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return DEFAULT_TTL_MS;
}

let _nudgeStore: NudgeStoreFile | null = null;

function loadNudgeStore(): NudgeStoreFile {
  if (_nudgeStore !== null) return _nudgeStore;
  const filePath = nudgeFilePath();
  if (!fs.existsSync(filePath)) {
    _nudgeStore = {};
    return _nudgeStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    _nudgeStore = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? (parsed as NudgeStoreFile)
      : {};
  } catch {
    _nudgeStore = {};
  }
  return _nudgeStore;
}

function saveNudgeStore(store: NudgeStoreFile): void {
  const filePath = nudgeFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  _nudgeStore = store;
}

export function setPendingNudge(conversationKey: string, candidate: MemoryNudgeCandidate): void {
  const store = loadNudgeStore();
  const nudge: PendingMemoryNudge = {
    ...candidate,
    conversationKey,
    createdAt: new Date().toISOString(),
  };
  store[conversationKey] = nudge;
  saveNudgeStore(store);
}

export function getPendingNudge(conversationKey: string): PendingMemoryNudge | undefined {
  const store = loadNudgeStore();
  const nudge = store[conversationKey];
  if (!nudge) return undefined;

  // TTL check
  const ttlMs = getTtlMs();
  const age = Date.now() - new Date(nudge.createdAt).getTime();
  if (age > ttlMs) {
    clearPendingNudge(conversationKey);
    return undefined;
  }

  return nudge;
}

export function clearPendingNudge(conversationKey: string): void {
  const store = loadNudgeStore();
  if (!(conversationKey in store)) return;
  delete store[conversationKey];
  saveNudgeStore(store);
}

/** Test helper: clear in-memory cache and remove the file. */
export function _resetMemoryNudgesForTests(): void {
  _nudgeStore = null;
  try {
    const filePath = nudgeFilePath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

const ACCEPT_REPLIES = new Set(['はい', 'うん', '覚えて', 'お願い', 'yes', 'y', 'ok', 'sure']);
const DECLINE_REPLIES = new Set(['いいえ', 'いらない', '不要', 'やめて', 'no', 'n']);

const MAX_NUDGE_REPLY_LENGTH = 12;

export function parseNudgeReply(text: string): 'accept' | 'decline' | null {
  const trimmed = text.trim();
  if (trimmed.length > MAX_NUDGE_REPLY_LENGTH) return null;
  const lower = trimmed.toLowerCase();
  if (ACCEPT_REPLIES.has(trimmed) || ACCEPT_REPLIES.has(lower)) return 'accept';
  if (DECLINE_REPLIES.has(trimmed) || DECLINE_REPLIES.has(lower)) return 'decline';
  return null;
}

// ---------------------------------------------------------------------------
// Consume pending nudge
// ---------------------------------------------------------------------------

export async function consumePendingNudge(
  conversationKey: string,
  userText: string,
): Promise<{ consumed: boolean; reply?: string }> {
  if (!isMemoryNudgeEnabled()) return { consumed: false };

  const pending = getPendingNudge(conversationKey);
  if (!pending) return { consumed: false };

  const decision = parseNudgeReply(userText);

  if (decision === null) {
    // User moved on — clear pending, not consumed
    clearPendingNudge(conversationKey);
    return { consumed: false };
  }

  if (decision === 'accept') {
    clearPendingNudge(conversationKey);
    const store = new MemoryStore();
    try {
      store.upsert({
        kind: pending.kind,
        content: pending.content,
        sourceSessionId: conversationKey,
        metadata: { source: 'memory_nudge' },
      });
    } finally {
      store.close();
    }
    return { consumed: true, reply: `覚えました: ${pending.content}` };
  }

  // decline
  clearPendingNudge(conversationKey);
  return { consumed: true, reply: 'わかりました。今回は覚えません。' };
}

// ---------------------------------------------------------------------------
// Maybe create nudge
// ---------------------------------------------------------------------------

export function maybeCreateNudge(conversationKey: string, userText: string): string | null {
  if (!isMemoryNudgeEnabled()) return null;

  // Don't create if one already pending
  const existing = getPendingNudge(conversationKey);
  if (existing) return null;

  const candidate = detectMemoryCandidate(userText);
  if (!candidate) return null;

  setPendingNudge(conversationKey, candidate);
  return `\n\n💡 これは覚えますか？「${candidate.content}」（「はい」で記憶します）`;
}
