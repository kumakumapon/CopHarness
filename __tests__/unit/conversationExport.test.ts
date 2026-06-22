/**
 * Unit tests for listHistoryKeys in lib/history/store
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP_HISTORY_FILE = path.join(os.tmpdir(), `test-conv-export-${process.pid}.json`);

beforeAll(() => {
  process.env.CONVERSATION_HISTORY_FILE = TMP_HISTORY_FILE;
});

afterAll(async () => {
  delete process.env.CONVERSATION_HISTORY_FILE;
  try {
    fs.unlinkSync(TMP_HISTORY_FILE);
  } catch {
    // ignore if file was never created
  }
});

beforeEach(() => {
  jest.resetModules();
  if (fs.existsSync(TMP_HISTORY_FILE)) fs.unlinkSync(TMP_HISTORY_FILE);
});

async function getStore() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../lib/history/store') as typeof import('../../lib/history/store');
}

describe('listHistoryKeys', () => {
  it('returns empty array when no history exists', async () => {
    const { listHistoryKeys } = await getStore();
    expect(listHistoryKeys()).toEqual([]);
  });

  it('lists keys with correct message counts', async () => {
    const { saveHistory, listHistoryKeys } = await getStore();
    await saveHistory('user:A', [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]);
    await saveHistory('user:B', [{ role: 'user', content: 'world' }]);

    const keys = listHistoryKeys();
    expect(keys).toHaveLength(2);

    const entryA = keys.find((e) => e.key === 'user:A');
    const entryB = keys.find((e) => e.key === 'user:B');

    expect(entryA).toBeDefined();
    expect(entryA!.messageCount).toBe(2);

    expect(entryB).toBeDefined();
    expect(entryB!.messageCount).toBe(1);
  });

  it('is sorted by updatedAt descending (most recently updated first)', async () => {
    const { saveHistory, listHistoryKeys } = await getStore();

    // Save with artificial ordering: save A first, then B, then C
    // The last save wins (later updatedAt), so C should come first
    await saveHistory('key:first', [{ role: 'user', content: 'first' }]);
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    await saveHistory('key:second', [{ role: 'user', content: 'second' }]);
    await new Promise((r) => setTimeout(r, 5));
    await saveHistory('key:third', [{ role: 'user', content: 'third' }]);

    const keys = listHistoryKeys();
    expect(keys).toHaveLength(3);
    expect(keys[0].key).toBe('key:third');
    expect(keys[1].key).toBe('key:second');
    expect(keys[2].key).toBe('key:first');

    // Verify descending order by timestamp
    expect(keys[0].updatedAt).toBeGreaterThanOrEqual(keys[1].updatedAt);
    expect(keys[1].updatedAt).toBeGreaterThanOrEqual(keys[2].updatedAt);
  });

  it('reflects cleared history (removed key no longer appears)', async () => {
    const { saveHistory, clearHistory, listHistoryKeys } = await getStore();
    await saveHistory('key:keep', [{ role: 'user', content: 'keep me' }]);
    await saveHistory('key:remove', [{ role: 'user', content: 'remove me' }]);

    await clearHistory('key:remove');

    const keys = listHistoryKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe('key:keep');
  });
});
