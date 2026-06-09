import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../../lib/memory/store';
import { memoryForget, memoryGet, memoryList, memorySearch, memorySet, memoryUpsert } from '../../lib/skills/memory';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

describe('MemoryStore SQLite + FTS5', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-memory-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.MEMORY_DB_FILE;
    delete process.env.MEMORY_STORE_FORCE_JSON;
    delete process.env.SKILL_MEMORY_FILE;
    _resetDataDirCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts typed memories and searches them through FTS5', () => {
    const store = new MemoryStore();
    try {
      const record = store.upsert({
        key: 'project:phase1',
        kind: 'project',
        subject: 'CopHarness',
        content: 'Phase 1 needs SQLite memory and JSON approval policy completion.',
        importance: 0.9,
        confidence: 0.8,
        sourceSessionId: 'session-1',
        lastVerifiedAt: '2026-06-09T00:00:00Z',
      });

      const results = store.search({ query: 'SQLite approval', kind: 'project', subject: 'CopHarness' });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: record.id, key: 'project:phase1', kind: 'project', confidence: 0.8 });
      expect(store.explain('project:phase1')).toContain('sourceSessionId=session-1');
    } finally {
      store.close();
    }
  });

  it('honors SKILL_MEMORY_FILE for legacy test isolation', async () => {
    const firstFile = path.join(tmpDir, 'first-memory.json');
    const secondFile = path.join(tmpDir, 'second-memory.json');

    process.env.SKILL_MEMORY_FILE = firstFile;
    await memorySet.handler({ key: 'name', value: 'Alice' });

    process.env.SKILL_MEMORY_FILE = secondFile;
    await expect(memoryList.handler({})).resolves.toMatchObject({ content: '(memory is empty)' });
  });

  it('falls back to a JSON backend when node:sqlite is unavailable', () => {
    process.env.MEMORY_STORE_FORCE_JSON = 'true';
    process.env.MEMORY_DB_FILE = path.join(tmpDir, 'fallback.sqlite');

    const store = new MemoryStore();
    try {
      store.upsert({ key: 'fallback', kind: 'fact', content: 'JSON fallback still searches memory' });
      expect(store.search({ query: 'searches' })[0]).toMatchObject({ key: 'fallback' });
    } finally {
      store.close();
    }
  });

  it('keeps legacy memory skill names as wrappers over the SQLite store', async () => {
    const set = await memorySet.handler({ key: 'favorite', value: 'SQLite FTS' });
    expect(set.isError).toBeFalsy();
    await expect(memoryGet.handler({ key: 'favorite' })).resolves.toMatchObject({ content: 'SQLite FTS' });

    const search = await memorySearch.handler({ query: 'FTS' });
    expect(search.content).toContain('favorite');

    const upsert = await memoryUpsert.handler({ key: 'preference:editor', kind: 'preference', subject: 'user', content: 'Prefers concise dashboards' });
    expect(upsert.isError).toBeFalsy();

    const deleted = await memoryForget.handler({ idOrKey: 'favorite' });
    expect(deleted.content).toContain('Forgot memory favorite');
    await expect(memoryGet.handler({ key: 'favorite' })).resolves.toMatchObject({ content: '(no value stored for key "favorite")' });
  });
});
