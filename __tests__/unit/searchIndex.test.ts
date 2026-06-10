/**
 * Unit tests for lib/search/index.ts
 *
 * Two describe blocks:
 *   1. JSON fallback (forced via env) — always runs
 *   2. SQLite FTS5 — runs if node:sqlite is available (same guard as memoryStore.test.ts)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSqliteAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

// ── JSON fallback describe ────────────────────────────────────────────────────

describe('SearchIndex — JSON fallback', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-search-json-'));
    process.env.DATA_DIR = tmpDir;
    process.env.SEARCH_INDEX_FORCE_JSON = 'true';
    _resetDataDirCache();
    // Reset singleton
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.SEARCH_INDEX_FORCE_JSON;
    delete process.env.SEARCH_INDEX_FILE;
    delete process.env.SEARCH_INDEX_ENABLED;
    _resetDataDirCache();
    jest.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function getIndex() {
    const mod = await import('../../lib/search/index');
    mod._resetSearchIndexForTests();
    return mod;
  }

  it('upserts and searches a conversation document', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'test.json.placeholder'));
    try {
      idx.upsert({
        id: 'conv1:0',
        type: 'conversation',
        conversationKey: 'line:U001',
        role: 'user',
        content: 'Hello, how does SQLite full-text search work?',
        createdAt: new Date().toISOString(),
      });

      const hits = idx.search({ query: 'SQLite' });
      expect(hits).toHaveLength(1);
      expect(hits[0].id).toBe('conv1:0');
      expect(hits[0].snippet).toMatch(/SQLite/i);
    } finally {
      idx.close();
    }
  });

  it('upserts and searches a task document', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'test2.json.placeholder'));
    try {
      idx.upsert({
        id: 'task:abc',
        type: 'task',
        taskId: 'abc',
        title: 'Analyse report',
        content: 'Analyse report api succeeded',
        createdAt: new Date().toISOString(),
      });

      const hits = idx.search({ query: 'Analyse' });
      expect(hits).toHaveLength(1);
      expect(hits[0].type).toBe('task');
    } finally {
      idx.close();
    }
  });

  it('filters by type', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'test3.json.placeholder'));
    try {
      idx.upsert({ id: 'c:0', type: 'conversation', content: 'apple', createdAt: new Date().toISOString() });
      idx.upsert({ id: 't:1', type: 'task', content: 'apple', createdAt: new Date().toISOString() });

      const convHits = idx.search({ query: 'apple', type: 'conversation' });
      expect(convHits).toHaveLength(1);
      expect(convHits[0].type).toBe('conversation');

      const taskHits = idx.search({ query: 'apple', type: 'task' });
      expect(taskHits).toHaveLength(1);
      expect(taskHits[0].type).toBe('task');
    } finally {
      idx.close();
    }
  });

  it('filters by conversationKey', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'test4.json.placeholder'));
    try {
      idx.upsert({ id: 'a:0', type: 'conversation', conversationKey: 'line:A', content: 'orange fruit', createdAt: new Date().toISOString() });
      idx.upsert({ id: 'b:0', type: 'conversation', conversationKey: 'line:B', content: 'orange fruit', createdAt: new Date().toISOString() });

      const hits = idx.search({ query: 'orange', conversationKey: 'line:A' });
      expect(hits).toHaveLength(1);
      expect(hits[0].conversationKey).toBe('line:A');
    } finally {
      idx.close();
    }
  });

  it('respects limit', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'test5.json.placeholder'));
    try {
      for (let i = 0; i < 5; i++) {
        idx.upsert({ id: `doc:${i}`, type: 'task', content: `banana task ${i}`, createdAt: new Date().toISOString() });
      }
      const hits = idx.search({ query: 'banana', limit: 3 });
      expect(hits.length).toBeLessThanOrEqual(3);
    } finally {
      idx.close();
    }
  });

  it('snippet contains the query term', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'test6.json.placeholder'));
    try {
      idx.upsert({
        id: 'snip:0',
        type: 'conversation',
        content: 'A very long sentence that eventually mentions the word strawberry somewhere in the middle of this text.',
        createdAt: new Date().toISOString(),
      });
      const hits = idx.search({ query: 'strawberry' });
      expect(hits[0].snippet).toMatch(/strawberry/i);
    } finally {
      idx.close();
    }
  });

  it('id-keyed upsert does not duplicate (re-upsert same id replaces)', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'test7.json.placeholder'));
    try {
      idx.upsert({ id: 'dup:0', type: 'conversation', content: 'first version', createdAt: new Date().toISOString() });
      idx.upsert({ id: 'dup:0', type: 'conversation', content: 'updated version', createdAt: new Date().toISOString() });

      expect(idx.count()).toBe(1);
      const hits = idx.search({ query: 'updated' });
      expect(hits).toHaveLength(1);
      expect(hits[0].content).toBe('updated version');
    } finally {
      idx.close();
    }
  });

  it('isSearchIndexEnabled returns false when SEARCH_INDEX_ENABLED=false', async () => {
    process.env.SEARCH_INDEX_ENABLED = 'false';
    jest.resetModules();
    const { isSearchIndexEnabled } = await import('../../lib/search/index');
    expect(isSearchIndexEnabled()).toBe(false);
  });

  it('isSearchIndexEnabled returns true by default', async () => {
    const { isSearchIndexEnabled } = await getIndex();
    expect(isSearchIndexEnabled()).toBe(true);
  });

  it('count returns 0 on an empty index', async () => {
    const { SearchIndex } = await getIndex();
    const idx = new SearchIndex(path.join(tmpDir, 'empty.json.placeholder'));
    try {
      expect(idx.count()).toBe(0);
    } finally {
      idx.close();
    }
  });
});

// ── SQLite FTS5 describe ──────────────────────────────────────────────────────

const describeSqlite = isSqliteAvailable() ? describe : describe.skip;

describeSqlite('SearchIndex — SQLite FTS5', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-search-sqlite-'));
    process.env.DATA_DIR = tmpDir;
    delete process.env.SEARCH_INDEX_FORCE_JSON;
    _resetDataDirCache();
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.SEARCH_INDEX_FORCE_JSON;
    delete process.env.SEARCH_INDEX_FILE;
    delete process.env.SEARCH_INDEX_ENABLED;
    _resetDataDirCache();
    jest.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function getIndex() {
    const mod = await import('../../lib/search/index');
    mod._resetSearchIndexForTests();
    return mod;
  }

  it('upserts and searches with bm25 ranking', async () => {
    const { SearchIndex } = await getIndex();
    const dbPath = path.join(tmpDir, 'fts5.sqlite');
    const idx = new SearchIndex(dbPath);
    try {
      idx.upsert({
        id: 'conv:0',
        type: 'conversation',
        conversationKey: 'discord:abc',
        role: 'assistant',
        content: 'You can use SQLite FTS5 for blazing-fast full-text search.',
        createdAt: new Date().toISOString(),
      });
      idx.upsert({
        id: 'conv:1',
        type: 'conversation',
        conversationKey: 'discord:abc',
        role: 'user',
        content: 'What about PostgreSQL full-text search instead?',
        createdAt: new Date().toISOString(),
      });

      const hits = idx.search({ query: 'FTS5 SQLite' });
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].id).toBe('conv:0');
    } finally {
      idx.close();
    }
  });

  it('type filter works', async () => {
    const { SearchIndex } = await getIndex();
    const dbPath = path.join(tmpDir, 'filter.sqlite');
    const idx = new SearchIndex(dbPath);
    try {
      idx.upsert({ id: 'c:0', type: 'conversation', content: 'mango search test', createdAt: new Date().toISOString() });
      idx.upsert({ id: 't:0', type: 'task', content: 'mango search test', createdAt: new Date().toISOString() });

      const taskHits = idx.search({ query: 'mango', type: 'task' });
      expect(taskHits).toHaveLength(1);
      expect(taskHits[0].type).toBe('task');
    } finally {
      idx.close();
    }
  });

  it('id-keyed upsert replaces, count stays at 1', async () => {
    const { SearchIndex } = await getIndex();
    const dbPath = path.join(tmpDir, 'dedup.sqlite');
    const idx = new SearchIndex(dbPath);
    try {
      idx.upsert({ id: 'x:0', type: 'task', content: 'initial content', createdAt: new Date().toISOString() });
      idx.upsert({ id: 'x:0', type: 'task', content: 'replaced content', createdAt: new Date().toISOString() });

      expect(idx.count()).toBe(1);
      const hits = idx.search({ query: 'replaced' });
      expect(hits[0].content).toBe('replaced content');
    } finally {
      idx.close();
    }
  });

  it('limit is honoured', async () => {
    const { SearchIndex } = await getIndex();
    const dbPath = path.join(tmpDir, 'limit.sqlite');
    const idx = new SearchIndex(dbPath);
    try {
      for (let i = 0; i < 6; i++) {
        idx.upsert({ id: `lim:${i}`, type: 'task', content: `grape task item ${i}`, createdAt: new Date().toISOString() });
      }
      const hits = idx.search({ query: 'grape', limit: 2 });
      expect(hits.length).toBeLessThanOrEqual(2);
    } finally {
      idx.close();
    }
  });

  it('snippet contains the search term', async () => {
    const { SearchIndex } = await getIndex();
    const dbPath = path.join(tmpDir, 'snippet.sqlite');
    const idx = new SearchIndex(dbPath);
    try {
      idx.upsert({
        id: 's:0',
        type: 'conversation',
        content: 'This document mentions the exotic fruit called dragonfruit somewhere inside.',
        createdAt: new Date().toISOString(),
      });
      const hits = idx.search({ query: 'dragonfruit' });
      expect(hits[0].snippet).toMatch(/dragonfruit/i);
    } finally {
      idx.close();
    }
  });

  it('conversationKey filter narrows results', async () => {
    const { SearchIndex } = await getIndex();
    const dbPath = path.join(tmpDir, 'ckfilter.sqlite');
    const idx = new SearchIndex(dbPath);
    try {
      idx.upsert({ id: 'k:0', type: 'conversation', conversationKey: 'line:X', content: 'pear fruit', createdAt: new Date().toISOString() });
      idx.upsert({ id: 'k:1', type: 'conversation', conversationKey: 'line:Y', content: 'pear fruit', createdAt: new Date().toISOString() });

      const hits = idx.search({ query: 'pear', conversationKey: 'line:X' });
      expect(hits).toHaveLength(1);
      expect(hits[0].conversationKey).toBe('line:X');
    } finally {
      idx.close();
    }
  });
});
