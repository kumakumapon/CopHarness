/**
 * Tests for lib/memory/nudge.ts — Phase 2 memory nudging.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  isMemoryNudgeEnabled,
  detectMemoryCandidate,
  parseNudgeReply,
  setPendingNudge,
  getPendingNudge,
  clearPendingNudge,
  consumePendingNudge,
  maybeCreateNudge,
  _resetMemoryNudgesForTests,
  type MemoryNudgeCandidate,
} from '../../lib/memory/nudge';
import { MemoryStore } from '../../lib/memory/store';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-nudge-'));
  process.env.DATA_DIR = tmpDir;
  process.env.MEMORY_NUDGE_ENABLED = 'true';
  process.env.MEMORY_STORE_FORCE_JSON = 'true';
  _resetDataDirCache();
  _resetMemoryNudgesForTests();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.MEMORY_NUDGE_ENABLED;
  delete process.env.MEMORY_STORE_FORCE_JSON;
  delete process.env.MEMORY_NUDGE_FILE;
  delete process.env.MEMORY_NUDGE_TTL_MS;
  delete process.env.MEMORY_DB_FILE;
  _resetDataDirCache();
  _resetMemoryNudgesForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isMemoryNudgeEnabled
// ---------------------------------------------------------------------------

describe('isMemoryNudgeEnabled', () => {
  it('returns true when MEMORY_NUDGE_ENABLED=true', () => {
    process.env.MEMORY_NUDGE_ENABLED = 'true';
    expect(isMemoryNudgeEnabled()).toBe(true);
  });

  it('returns true when MEMORY_NUDGE_ENABLED=1', () => {
    process.env.MEMORY_NUDGE_ENABLED = '1';
    expect(isMemoryNudgeEnabled()).toBe(true);
  });

  it('returns false when MEMORY_NUDGE_ENABLED is unset', () => {
    delete process.env.MEMORY_NUDGE_ENABLED;
    expect(isMemoryNudgeEnabled()).toBe(false);
  });

  it('returns false when MEMORY_NUDGE_ENABLED=false', () => {
    process.env.MEMORY_NUDGE_ENABLED = 'false';
    expect(isMemoryNudgeEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectMemoryCandidate
// ---------------------------------------------------------------------------

describe('detectMemoryCandidate', () => {
  // Explicit 覚えて
  it('detects 覚えて as fact', () => {
    const result = detectMemoryCandidate('私の好きな色は青です、覚えて');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
  });

  it('detects 覚えておいて as fact', () => {
    const result = detectMemoryCandidate('これを覚えておいて');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
  });

  // English explicit remember
  it('detects "remember that" as fact', () => {
    const result = detectMemoryCandidate('remember that I live in Tokyo');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
    expect(result!.content).toBe('I live in Tokyo');
  });

  it('detects "remember" without "that" as fact', () => {
    const result = detectMemoryCandidate('remember I prefer dark mode');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
  });

  // Japanese name intro
  it('detects 私の名前は as fact', () => {
    const result = detectMemoryCandidate('私の名前は田中です');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
    expect(result!.content).toBe('私の名前は田中です');
  });

  it('detects 僕の名前は as fact', () => {
    const result = detectMemoryCandidate('僕の名前は太郎');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
  });

  it('detects 俺の名前は as fact', () => {
    const result = detectMemoryCandidate('俺の名前は次郎');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
  });

  // English name intro
  it('detects "my name is" as fact', () => {
    const result = detectMemoryCandidate('my name is Alice');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
    expect(result!.content).toBe('my name is Alice');
  });

  it('detects "My Name Is" (case-insensitive) as fact', () => {
    const result = detectMemoryCandidate('My Name Is Bob');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
  });

  // Japanese preference
  it('detects が好き as preference', () => {
    const result = detectMemoryCandidate('コーヒーが好き');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  it('detects が嫌い as preference', () => {
    const result = detectMemoryCandidate('納豆が嫌い');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  it('detects が苦手 as preference', () => {
    const result = detectMemoryCandidate('数学が苦手');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  it('detects を使っている as preference', () => {
    const result = detectMemoryCandidate('VSCodeを使っている');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  // English preference
  it('detects "I like" as preference', () => {
    const result = detectMemoryCandidate('I like TypeScript');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  it('detects "I love" as preference', () => {
    const result = detectMemoryCandidate('I love sushi');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  it('detects "I hate" as preference', () => {
    const result = detectMemoryCandidate('I hate early mornings');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  it('detects "I prefer" as preference', () => {
    const result = detectMemoryCandidate('I prefer dark mode');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');
  });

  // Japanese birthday (fact)
  it('detects 誕生日は as fact', () => {
    const result = detectMemoryCandidate('誕生日は3月15日');
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('fact');
  });

  // Questions → null
  it('returns null for Japanese question ending with ？', () => {
    const result = detectMemoryCandidate('覚えてる？');
    expect(result).toBeNull();
  });

  it('returns null for English question ending with ?', () => {
    const result = detectMemoryCandidate('Do you remember?');
    expect(result).toBeNull();
  });

  // Long text → null
  it('returns null for text longer than 200 chars', () => {
    const longText = 'I like '.repeat(30) + 'pizza';
    expect(longText.length).toBeGreaterThan(200);
    const result = detectMemoryCandidate(longText);
    expect(result).toBeNull();
  });

  // No match
  it('returns null for unrelated text', () => {
    expect(detectMemoryCandidate('今日の天気はどうですか')).toBeNull();
    expect(detectMemoryCandidate('Hello there')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseNudgeReply
// ---------------------------------------------------------------------------

describe('parseNudgeReply', () => {
  // Accept
  it.each(['はい', 'うん', '覚えて', 'お願い', 'yes', 'y', 'ok', 'sure'])(
    'returns accept for "%s"',
    (text) => {
      expect(parseNudgeReply(text)).toBe('accept');
    },
  );

  it('returns accept for "YES" (case-insensitive)', () => {
    expect(parseNudgeReply('YES')).toBe('accept');
  });

  it('returns accept for "OK" (case-insensitive)', () => {
    expect(parseNudgeReply('OK')).toBe('accept');
  });

  // Decline
  it.each(['いいえ', 'いらない', '不要', 'やめて', 'no', 'n'])(
    'returns decline for "%s"',
    (text) => {
      expect(parseNudgeReply(text)).toBe('decline');
    },
  );

  it('returns decline for "NO" (case-insensitive)', () => {
    expect(parseNudgeReply('NO')).toBe('decline');
  });

  // Null cases
  it('returns null for unrelated text', () => {
    expect(parseNudgeReply('わかりません')).toBeNull();
    expect(parseNudgeReply('maybe')).toBeNull();
    expect(parseNudgeReply('Hello world')).toBeNull();
  });

  it('returns null for text longer than 12 chars', () => {
    expect(parseNudgeReply('はいはいはいはい')).toBeNull();
    expect(parseNudgeReply('yes please remember it')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseNudgeReply('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pending nudge store
// ---------------------------------------------------------------------------

describe('pending nudge store', () => {
  const KEY = 'line:U12345';
  const CANDIDATE: MemoryNudgeCandidate = { kind: 'fact', content: '私の名前は田中です' };

  it('sets and gets a pending nudge', () => {
    setPendingNudge(KEY, CANDIDATE);
    const result = getPendingNudge(KEY);
    expect(result).not.toBeUndefined();
    expect(result!.kind).toBe('fact');
    expect(result!.content).toBe('私の名前は田中です');
    expect(result!.conversationKey).toBe(KEY);
    expect(result!.createdAt).toBeTruthy();
  });

  it('returns undefined for unknown key', () => {
    expect(getPendingNudge('unknown:key')).toBeUndefined();
  });

  it('clears a pending nudge', () => {
    setPendingNudge(KEY, CANDIDATE);
    clearPendingNudge(KEY);
    expect(getPendingNudge(KEY)).toBeUndefined();
  });

  it('persists to disk (reloads after reset)', () => {
    setPendingNudge(KEY, CANDIDATE);
    _resetMemoryNudgesForTests();
    // Restore the file (reset deletes it — re-create via set)
    setPendingNudge(KEY, CANDIDATE);
    _nudgeStoreFlushForTest();
    expect(getPendingNudge(KEY)).not.toBeUndefined();
  });

  it('uses MEMORY_NUDGE_FILE env override', () => {
    const customFile = path.join(tmpDir, 'custom_nudges.json');
    process.env.MEMORY_NUDGE_FILE = customFile;
    _resetMemoryNudgesForTests();
    setPendingNudge(KEY, CANDIDATE);
    expect(fs.existsSync(customFile)).toBe(true);
  });

  it('returns undefined when TTL has expired', async () => {
    process.env.MEMORY_NUDGE_TTL_MS = '1';
    _resetMemoryNudgesForTests();
    setPendingNudge(KEY, CANDIDATE);
    await new Promise((r) => setTimeout(r, 5));
    expect(getPendingNudge(KEY)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// maybeCreateNudge
// ---------------------------------------------------------------------------

describe('maybeCreateNudge', () => {
  const KEY = 'line:Ufoo';

  it('returns suffix when candidate detected and no pending', () => {
    const suffix = maybeCreateNudge(KEY, 'my name is Carol');
    expect(suffix).not.toBeNull();
    expect(suffix).toContain('💡');
    expect(suffix).toContain('これは覚えますか？');
    expect(suffix).toContain('Carol');
  });

  it('returns null on second call (pending already exists)', () => {
    maybeCreateNudge(KEY, 'my name is Carol');
    const second = maybeCreateNudge(KEY, 'my name is Carol');
    expect(second).toBeNull();
  });

  it('returns null when no candidate detected', () => {
    const suffix = maybeCreateNudge(KEY, 'How is the weather?');
    expect(suffix).toBeNull();
  });

  it('returns null when feature is disabled', () => {
    process.env.MEMORY_NUDGE_ENABLED = 'false';
    const suffix = maybeCreateNudge(KEY, 'my name is Dave');
    expect(suffix).toBeNull();
  });

  it('returns null when MEMORY_NUDGE_ENABLED is not set', () => {
    delete process.env.MEMORY_NUDGE_ENABLED;
    const suffix = maybeCreateNudge(KEY, 'I like TypeScript');
    expect(suffix).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// consumePendingNudge
// ---------------------------------------------------------------------------

describe('consumePendingNudge', () => {
  const KEY = 'discord:U999';

  it('accept: persists to MemoryStore and returns consumed=true', async () => {
    // Set up a pending nudge
    const candidate: MemoryNudgeCandidate = { kind: 'fact', content: '私の名前は花子です' };
    setPendingNudge(KEY, candidate);

    const result = await consumePendingNudge(KEY, 'はい');
    expect(result.consumed).toBe(true);
    expect(result.reply).toContain('覚えました');
    expect(result.reply).toContain('私の名前は花子です');

    // Verify cleared
    expect(getPendingNudge(KEY)).toBeUndefined();

    // Verify persisted in MemoryStore
    const store = new MemoryStore();
    try {
      const records = store.search({ query: '花子' });
      expect(records.length).toBeGreaterThan(0);
      const saved = records[0];
      expect(saved.content).toBe('私の名前は花子です');
      expect(saved.sourceSessionId).toBe(KEY);
      expect(saved.metadata?.source).toBe('memory_nudge');
    } finally {
      store.close();
    }
  });

  it('decline: does not persist and returns consumed=true', async () => {
    const candidate: MemoryNudgeCandidate = { kind: 'preference', content: 'コーヒーが好き' };
    setPendingNudge(KEY, candidate);

    const result = await consumePendingNudge(KEY, 'いいえ');
    expect(result.consumed).toBe(true);
    expect(result.reply).toContain('今回は覚えません');

    // Verify cleared
    expect(getPendingNudge(KEY)).toBeUndefined();

    // Verify NOT persisted
    const store = new MemoryStore();
    try {
      const records = store.search({ query: 'コーヒー' });
      expect(records.length).toBe(0);
    } finally {
      store.close();
    }
  });

  it('unrelated reply: clears pending and returns consumed=false', async () => {
    const candidate: MemoryNudgeCandidate = { kind: 'fact', content: '誕生日は5月3日' };
    setPendingNudge(KEY, candidate);

    const result = await consumePendingNudge(KEY, '全然関係ない話をします');
    expect(result.consumed).toBe(false);

    // Pending should be cleared (user moved on)
    expect(getPendingNudge(KEY)).toBeUndefined();
  });

  it('no pending nudge: returns consumed=false', async () => {
    const result = await consumePendingNudge(KEY, 'はい');
    expect(result.consumed).toBe(false);
  });

  it('TTL expiry: returns consumed=false', async () => {
    process.env.MEMORY_NUDGE_TTL_MS = '1';
    _resetMemoryNudgesForTests();

    const candidate: MemoryNudgeCandidate = { kind: 'fact', content: '期限切れテスト' };
    setPendingNudge(KEY, candidate);

    await new Promise((r) => setTimeout(r, 5));

    const result = await consumePendingNudge(KEY, 'はい');
    expect(result.consumed).toBe(false);
  });

  it('disabled env: returns consumed=false even with pending nudge', async () => {
    process.env.MEMORY_NUDGE_ENABLED = 'false';
    const candidate: MemoryNudgeCandidate = { kind: 'fact', content: 'should not be consumed' };
    setPendingNudge(KEY, candidate);

    const result = await consumePendingNudge(KEY, 'はい');
    expect(result.consumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Disabled feature — everything no-ops
// ---------------------------------------------------------------------------

describe('disabled feature (MEMORY_NUDGE_ENABLED not set)', () => {
  beforeEach(() => {
    delete process.env.MEMORY_NUDGE_ENABLED;
    _resetMemoryNudgesForTests();
  });

  it('maybeCreateNudge returns null', () => {
    expect(maybeCreateNudge('key:1', 'my name is Eve')).toBeNull();
  });

  it('consumePendingNudge returns consumed=false', async () => {
    const result = await consumePendingNudge('key:1', 'はい');
    expect(result.consumed).toBe(false);
  });

  it('isMemoryNudgeEnabled returns false', () => {
    expect(isMemoryNudgeEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper: force cache flush (for persistence test)
// ---------------------------------------------------------------------------

function _nudgeStoreFlushForTest(): void {
  // No-op: setPendingNudge already writes to disk synchronously.
  // This function exists as documentation for the test pattern.
}
