import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../../lib/extensions/memory/store';
import { memoryExplain, memoryForget, memorySearch, memoryUpsert } from '../../lib/extensions/memory/skills/memory';
import { _resetDataDirCache } from '../../lib/core/utils/dataDir';

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

  it('honors SKILL_MEMORY_FILE as the legacy name of MEMORY_DB_FILE', async () => {
    const firstFile = path.join(tmpDir, 'first-memory.sqlite');
    const secondFile = path.join(tmpDir, 'second-memory.sqlite');

    process.env.SKILL_MEMORY_FILE = firstFile;
    await memoryUpsert.handler({ key: 'name', content: 'Alice' });

    process.env.SKILL_MEMORY_FILE = secondFile;
    await expect(memorySearch.handler({})).resolves.toMatchObject({ content: '(no matching memories)' });

    process.env.SKILL_MEMORY_FILE = firstFile;
    expect((await memorySearch.handler({})).content).toContain('Alice');
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

  it('upserts, searches, explains and forgets through the registered skills', async () => {
    const saved = await memoryUpsert.handler({ key: 'favorite', content: 'SQLite FTS' });
    expect(saved.isError).toBeFalsy();
    expect((await memorySearch.handler({ query: 'FTS' })).content).toContain('favorite');
    expect((await memoryExplain.handler({ idOrKey: 'favorite' })).content).toContain('SQLite FTS');

    // Same key updates in place instead of creating a second record.
    await memoryUpsert.handler({ key: 'favorite', content: 'SQLite FTS5' });
    const results = (await memorySearch.handler({ query: 'FTS5' })).content as string;
    expect(results.split('\n')).toHaveLength(1);

    const upsert = await memoryUpsert.handler({ key: 'preference:editor', kind: 'preference', subject: 'user', content: 'Prefers concise dashboards' });
    expect(upsert.isError).toBeFalsy();

    const deleted = await memoryForget.handler({ idOrKey: 'favorite' });
    expect(deleted.content).toContain('Forgot memory favorite');
    expect((await memoryForget.handler({ idOrKey: 'favorite' })).content).toContain('no memory found');
  });
});
