/**
 * Unit tests for lib/history/store
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { LLMMessage } from '../../lib/adapter';

// We set CONVERSATION_HISTORY_FILE to an isolated tmp path before importing
const TMP_HISTORY_FILE = path.join('/tmp', `test-conversation-history-${process.pid}.json`);

beforeAll(() => {
  process.env.CONVERSATION_HISTORY_FILE = TMP_HISTORY_FILE;
});

afterAll(async () => {
  delete process.env.CONVERSATION_HISTORY_FILE;
  try {
    await fsp.unlink(TMP_HISTORY_FILE);
  } catch {
    // ignore if file was never created
  }
});

// Import AFTER setting env so the module picks up the custom path
import { loadHistory, saveHistory, clearHistory } from '../../lib/history/store';

describe('loadHistory', () => {
  it('returns an empty array when no history file exists', () => {
    // Ensure file does not exist
    if (fs.existsSync(TMP_HISTORY_FILE)) fs.unlinkSync(TMP_HISTORY_FILE);
    const result = loadHistory('user:nobody');
    expect(result).toEqual([]);
  });

  it('returns an empty array for an unknown key when file exists', async () => {
    await saveHistory('user:known', [{ role: 'user', content: 'hello' }]);
    const result = loadHistory('user:unknown');
    expect(result).toEqual([]);
  });
});

describe('saveHistory / loadHistory round-trip', () => {
  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'こんにちは' },
    { role: 'assistant', content: 'こんにちは！何かお手伝いできることはありますか？' },
  ];

  it('persists and restores a conversation history', async () => {
    await saveHistory('line:U123', messages);
    const restored = loadHistory('line:U123');
    expect(restored).toEqual(messages);
  });

  it('returns an independent copy (mutations do not affect stored state)', async () => {
    await saveHistory('line:U456', [{ role: 'user', content: 'original' }]);
    const copy = loadHistory('line:U456');
    copy.push({ role: 'assistant', content: 'mutated' });
    // Re-read from disk – should still have original content
    const fresh = loadHistory('line:U456');
    expect(fresh).toEqual([{ role: 'user', content: 'original' }]);
  });

  it('overwrites history for the same key on repeated saves', async () => {
    const key = 'discord:C001';
    await saveHistory(key, [{ role: 'user', content: 'first' }]);
    await saveHistory(key, [{ role: 'user', content: 'second' }]);
    const restored = loadHistory(key);
    expect(restored).toEqual([{ role: 'user', content: 'second' }]);
  });

  it('stores multiple keys independently', async () => {
    await saveHistory('line:A', [{ role: 'user', content: 'Alice' }]);
    await saveHistory('line:B', [{ role: 'user', content: 'Bob' }]);
    expect(loadHistory('line:A')).toEqual([{ role: 'user', content: 'Alice' }]);
    expect(loadHistory('line:B')).toEqual([{ role: 'user', content: 'Bob' }]);
  });
});

describe('clearHistory', () => {
  it('removes a stored history', async () => {
    const key = 'line:CLEAR_ME';
    await saveHistory(key, [{ role: 'user', content: 'bye' }]);
    await clearHistory(key);
    expect(loadHistory(key)).toEqual([]);
  });

  it('is a no-op for a key that does not exist', async () => {
    await expect(clearHistory('line:NONEXISTENT')).resolves.toBeUndefined();
  });
});
