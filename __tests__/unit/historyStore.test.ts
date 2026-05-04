/**
 * Unit tests for lib/history/store
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { LLMMessage } from '../../lib/adapter';

// Use an isolated tmp file so tests do not pollute the working directory.
const TMP_HISTORY_FILE = path.join(os.tmpdir(), `test-conversation-history-${process.pid}.json`);
// Temporary DATA_DIR for DATA_DIR tests
const TMP_DATA_DIR = path.join(os.tmpdir(), `test-copharness-data-${process.pid}`);

beforeAll(() => {
  process.env.CONVERSATION_HISTORY_FILE = TMP_HISTORY_FILE;
});

afterAll(async () => {
  delete process.env.CONVERSATION_HISTORY_FILE;
  delete process.env.DATA_DIR;
  try {
    await fsp.unlink(TMP_HISTORY_FILE);
  } catch {
    // ignore if file was never created
  }
  try {
    await fsp.rm(TMP_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// The store module maintains a singleton; we reset it between tests by
// re-requiring the module via jest module registry isolation.
beforeEach(() => {
  // Reset the in-memory singleton and remove the tmp file so each test starts clean.
  jest.resetModules();
  if (fs.existsSync(TMP_HISTORY_FILE)) fs.unlinkSync(TMP_HISTORY_FILE);
  // Ensure DATA_DIR cache is cleared between tests
  delete process.env.DATA_DIR;
});

// Helper: import a fresh instance of the store after resetModules()
async function getStore() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../lib/history/store') as typeof import('../../lib/history/store');
}

describe('loadHistory', () => {
  it('returns an empty array when no history file exists', async () => {
    const { loadHistory } = await getStore();
    expect(loadHistory('user:nobody')).toEqual([]);
  });

  it('returns an empty array for an unknown key when file exists', async () => {
    const { loadHistory, saveHistory } = await getStore();
    await saveHistory('user:known', [{ role: 'user', content: 'hello' }]);
    expect(loadHistory('user:unknown')).toEqual([]);
  });
});

describe('saveHistory / loadHistory round-trip', () => {
  const messages: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'こんにちは' },
    { role: 'assistant', content: 'こんにちは！何かお手伝いできることはありますか？' },
  ];

  it('persists and restores a conversation history', async () => {
    const { loadHistory, saveHistory } = await getStore();
    await saveHistory('line:U123', messages);
    expect(loadHistory('line:U123')).toEqual(messages);
  });

  it('returns an independent copy (mutations do not affect stored state)', async () => {
    const { loadHistory, saveHistory } = await getStore();
    await saveHistory('line:U456', [{ role: 'user', content: 'original' }]);
    const copy = loadHistory('line:U456');
    copy.push({ role: 'assistant', content: 'mutated' });
    expect(loadHistory('line:U456')).toEqual([{ role: 'user', content: 'original' }]);
  });

  it('overwrites history for the same key on repeated saves', async () => {
    const { loadHistory, saveHistory } = await getStore();
    const key = 'discord:C001';
    await saveHistory(key, [{ role: 'user', content: 'first' }]);
    await saveHistory(key, [{ role: 'user', content: 'second' }]);
    expect(loadHistory(key)).toEqual([{ role: 'user', content: 'second' }]);
  });

  it('stores multiple keys independently', async () => {
    const { loadHistory, saveHistory } = await getStore();
    await saveHistory('line:A', [{ role: 'user', content: 'Alice' }]);
    await saveHistory('line:B', [{ role: 'user', content: 'Bob' }]);
    expect(loadHistory('line:A')).toEqual([{ role: 'user', content: 'Alice' }]);
    expect(loadHistory('line:B')).toEqual([{ role: 'user', content: 'Bob' }]);
  });

  it('restores history in a new module instance (survives "restart")', async () => {
    // First instance: save
    const store1 = await getStore();
    await store1.saveHistory('line:PERSIST', [{ role: 'user', content: 'remember me' }]);

    // Simulate restart: reset module registry so the singleton is re-initialised
    jest.resetModules();

    // Second instance: should load from the file written above
    const store2 = await getStore();
    expect(store2.loadHistory('line:PERSIST')).toEqual([{ role: 'user', content: 'remember me' }]);
  });
});

describe('clearHistory', () => {
  it('removes a stored history', async () => {
    const { loadHistory, saveHistory, clearHistory } = await getStore();
    const key = 'line:CLEAR_ME';
    await saveHistory(key, [{ role: 'user', content: 'bye' }]);
    await clearHistory(key);
    expect(loadHistory(key)).toEqual([]);
  });

  it('is a no-op for a key that does not exist', async () => {
    const { clearHistory } = await getStore();
    await expect(clearHistory('line:NONEXISTENT')).resolves.toBeUndefined();
  });
});

describe('DATA_DIR integration', () => {
  it('places conversation_history.json under DATA_DIR when set', async () => {
    // Unset CONVERSATION_HISTORY_FILE so DATA_DIR takes effect
    delete process.env.CONVERSATION_HISTORY_FILE;
    process.env.DATA_DIR = TMP_DATA_DIR;

    const { saveHistory, loadHistory } = await getStore();
    await saveHistory('line:DATADIRTEST', [{ role: 'user', content: 'stored in data dir' }]);

    const expectedFile = path.join(TMP_DATA_DIR, 'conversation_history.json');
    expect(fs.existsSync(expectedFile)).toBe(true);
    expect(loadHistory('line:DATADIRTEST')).toEqual([{ role: 'user', content: 'stored in data dir' }]);

    // Clean up
    fs.unlinkSync(expectedFile);
  });

  it('CONVERSATION_HISTORY_FILE takes precedence over DATA_DIR', async () => {
    process.env.DATA_DIR = TMP_DATA_DIR;
    process.env.CONVERSATION_HISTORY_FILE = TMP_HISTORY_FILE;

    const { saveHistory } = await getStore();
    await saveHistory('line:PRECEDENCE', [{ role: 'user', content: 'precedence test' }]);

    // File should be at the explicit path, not in TMP_DATA_DIR
    expect(fs.existsSync(TMP_HISTORY_FILE)).toBe(true);
    const dataDirFile = path.join(TMP_DATA_DIR, 'conversation_history.json');
    expect(fs.existsSync(dataDirFile)).toBe(false);
  });
});
