/**
 * Unit tests for search index hooks:
 *   - saveHistory indexes only new non-system messages
 *   - startTask / finishTask index the task (finish replaces, count stays 1)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LLMMessage } from '../../lib/adapter';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

const TMP_HISTORY_FILE = path.join(os.tmpdir(), `test-hook-history-${process.pid}.json`);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-hook-'));
  process.env.DATA_DIR = tmpDir;
  // Use JSON backend for predictable counts in tests
  process.env.SEARCH_INDEX_FORCE_JSON = 'true';
  // Give each test an isolated search file
  process.env.SEARCH_INDEX_FILE = path.join(tmpDir, 'search_hook.json.placeholder');
  process.env.CONVERSATION_HISTORY_FILE = TMP_HISTORY_FILE;
  _resetDataDirCache();
  jest.resetModules();
  if (fs.existsSync(TMP_HISTORY_FILE)) fs.unlinkSync(TMP_HISTORY_FILE);
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.SEARCH_INDEX_FORCE_JSON;
  delete process.env.SEARCH_INDEX_FILE;
  delete process.env.CONVERSATION_HISTORY_FILE;
  _resetDataDirCache();
  jest.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (fs.existsSync(TMP_HISTORY_FILE)) {
    try { fs.unlinkSync(TMP_HISTORY_FILE); } catch { /* ignore */ }
  }
});

async function getModules() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const history = require('../../lib/history/store') as typeof import('../../lib/history/store');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const searchMod = require('../../lib/search/index') as typeof import('../../lib/search/index');
  const ledger = require('../../lib/tasks/ledger') as typeof import('../../lib/tasks/ledger');
  // Reset singletons for isolation
  searchMod._resetSearchIndexForTests();
  ledger._resetTaskLedgerForTests();
  return { history, searchMod, ledger };
}

// ── Conversation hooks ──────────────────────────────────────────────────────

describe('saveHistory hooks SearchIndex', () => {
  it('indexes only new non-system messages on second save', async () => {
    const { history, searchMod } = await getModules();
    const key = 'test:conv1';

    // First save: system + user
    await history.saveHistory(key, [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'What is the capital of France?' },
    ]);

    // Second save: adds assistant message
    await history.saveHistory(key, [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'What is the capital of France?' },
      { role: 'assistant', content: 'The capital of France is Paris.' },
    ]);

    const idx = searchMod.getSearchIndex();
    // system message should not be indexed, so count = 2 (user + assistant)
    expect(idx.count()).toBe(2);

    const hits = idx.search({ query: 'Paris' });
    expect(hits).toHaveLength(1);
    expect(hits[0].role).toBe('assistant');
  });

  it('does not create duplicate entries when saveHistory is called multiple times with same messages', async () => {
    const { history, searchMod } = await getModules();
    const key = 'test:conv2';
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Tell me about TypeScript generics.' },
      { role: 'assistant', content: 'TypeScript generics allow you to write reusable code.' },
    ];

    await history.saveHistory(key, messages);
    // Save again with the exact same messages (count did not grow)
    await history.saveHistory(key, messages);

    const idx = searchMod.getSearchIndex();
    // Both messages indexed on first call; second call has previousCount = 2, no new messages
    expect(idx.count()).toBe(2);
  });

  it('does not index system messages', async () => {
    const { history, searchMod } = await getModules();
    await history.saveHistory('test:system', [
      { role: 'system', content: 'Only system message here.' },
    ]);
    const idx = searchMod.getSearchIndex();
    expect(idx.count()).toBe(0);
  });
});

// ── Task hooks ───────────────────────────────────────────────────────────────

describe('startTask / finishTask hooks SearchIndex', () => {
  it('startTask indexes the task', async () => {
    const { ledger, searchMod } = await getModules();
    await ledger.startTask({ kind: 'api', title: 'Fetch weather data' });
    const idx = searchMod.getSearchIndex();
    expect(idx.count()).toBe(1);
    const hits = idx.search({ query: 'Fetch weather' });
    expect(hits).toHaveLength(1);
    expect(hits[0].type).toBe('task');
  });

  it('finishTask replaces the indexed task — count stays 1', async () => {
    const { ledger, searchMod } = await getModules();
    const task = await ledger.startTask({ kind: 'conversation', title: 'Chat session' });

    const idx = searchMod.getSearchIndex();
    expect(idx.count()).toBe(1);

    await ledger.finishTask(task.id, 'succeeded');
    // finishTask upserts same id — still 1 doc
    expect(idx.count()).toBe(1);

    const hits = idx.search({ query: 'Chat session' });
    expect(hits).toHaveLength(1);
    expect(hits[0].taskId).toBe(task.id);
  });

  it('finishTask with error indexes errorPreview', async () => {
    const { ledger, searchMod } = await getModules();
    const task = await ledger.startTask({ kind: 'schedule', title: 'Nightly job' });
    await ledger.finishTask(task.id, 'failed', new Error('Connection timeout'));

    const idx = searchMod.getSearchIndex();
    const hits = idx.search({ query: 'timeout' });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].taskId).toBe(task.id);
  });
});
