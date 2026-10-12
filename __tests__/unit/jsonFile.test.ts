import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  atomicWriteFile,
  atomicWriteFileSync,
  atomicWriteJson,
  FileLockTimeoutError,
  readJsonFileSync,
  renameWithRetrySync,
  withFileLock,
  withFileLockSync,
} from '../../lib/core/utils/jsonFile';

describe('jsonFile', () => {
  let dir: string;
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-jsonfile-'));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const leftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

  describe('atomic writes', () => {
    it('writes content, creates parent directories and leaves no temp files', async () => {
      const a = path.join(dir, 'x', 'y', 'a.json');
      atomicWriteFileSync(a, '{"a":1}');
      expect(fs.readFileSync(a, 'utf-8')).toBe('{"a":1}');
      const b = path.join(dir, 'b.json');
      await atomicWriteJson(b, { b: 2 });
      expect(JSON.parse(fs.readFileSync(b, 'utf-8'))).toEqual({ b: 2 });
      await atomicWriteFile(b, 'plain');
      expect(fs.readFileSync(b, 'utf-8')).toBe('plain');
      expect(leftovers()).toEqual([]);
    });

    it('leaves the target untouched and cleans up when the final rename fails', () => {
      // Renaming a file onto a non-empty directory fails on every platform.
      const target = path.join(dir, 'target');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'keep.txt'), 'precious');
      expect(() => atomicWriteFileSync(target, '{"new":true}')).toThrow();
      expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf-8')).toBe('precious');
      expect(leftovers()).toEqual([]);
    });

    it('retries transient EPERM/EBUSY renames and then succeeds', () => {
      let calls = 0;
      const sleeps: number[] = [];
      renameWithRetrySync('a', 'b', () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
      }, (ms) => sleeps.push(ms));
      expect(calls).toBe(3);
      expect(sleeps).toEqual([10, 20]);
    });

    it('does not retry non-transient rename errors and gives up after repeated EPERM', () => {
      let calls = 0;
      expect(() => renameWithRetrySync('a', 'b', () => {
        calls += 1;
        throw Object.assign(new Error('io'), { code: 'EIO' });
      }, () => undefined)).toThrow('io');
      expect(calls).toBe(1);

      calls = 0;
      expect(() => renameWithRetrySync('a', 'b', () => {
        calls += 1;
        throw Object.assign(new Error('stuck'), { code: 'EPERM' });
      }, () => undefined)).toThrow('stuck');
      expect(calls).toBe(8);
    });
  });

  describe('readJsonFileSync', () => {
    it('returns the fallback for a missing file without side effects', () => {
      expect(readJsonFileSync(path.join(dir, 'nope.json'), () => ({ empty: true }))).toEqual({ empty: true });
      expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('parses valid JSON', () => {
      const file = path.join(dir, 'ok.json');
      fs.writeFileSync(file, '{"a":[1,2]}');
      expect(readJsonFileSync(file, () => ({}))).toEqual({ a: [1, 2] });
    });

    it('moves a corrupt file aside, warns, and returns the fallback (data is not lost)', () => {
      const file = path.join(dir, 'schedules.json');
      fs.writeFileSync(file, '{"schedules": [ {"id": "1"');
      expect(readJsonFileSync(file, () => ({ schedules: [] }))).toEqual({ schedules: [] });
      expect(fs.existsSync(file)).toBe(false);
      const moved = fs.readdirSync(dir).filter((f) => f.startsWith('schedules.json.corrupt-'));
      expect(moved).toHaveLength(1);
      expect(fs.readFileSync(path.join(dir, moved[0]), 'utf-8')).toBe('{"schedules": [ {"id": "1"');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    });

    it('rethrows non-ENOENT read errors instead of treating them as empty', () => {
      const unreadable = path.join(dir, 'a-directory.json');
      fs.mkdirSync(unreadable); // reading a directory fails with EISDIR, not ENOENT
      expect(() => readJsonFileSync(unreadable, () => ({}))).toThrow();
      expect(fs.existsSync(unreadable)).toBe(true); // not quarantined
    });
  });

  describe('file lock', () => {
    it('releases the lock after the callback, including when it throws', () => {
      const file = path.join(dir, 'f.json');
      expect(withFileLockSync(file, () => 42)).toBe(42);
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
      expect(() => withFileLockSync(file, () => { throw new Error('boom'); })).toThrow('boom');
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
    });

    it('times out while another live process holds the lock', () => {
      const file = path.join(dir, 'f.json');
      // The parent test process is "alive" and not the holder under test: use pid 1's parent-less stand-in by
      // writing our own pid with a fresh timestamp; the lock is only reclaimable when it is stale.
      fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      expect(() => withFileLockSync(file, () => 1, { timeoutMs: 60 })).toThrow(FileLockTimeoutError);
      expect(fs.existsSync(`${file}.lock`)).toBe(true); // not stolen
    });

    it('reclaims a lock whose owner process is gone', () => {
      const file = path.join(dir, 'f.json');
      fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, at: new Date().toISOString() }));
      expect(withFileLockSync(file, () => 'ran', { timeoutMs: 500 })).toBe('ran');
    });

    it('reclaims a lock that is older than staleMs', () => {
      const file = path.join(dir, 'f.json');
      fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.pid, at: 'old' }));
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(`${file}.lock`, old, old);
      expect(withFileLockSync(file, () => 'ran', { timeoutMs: 500, staleMs: 1_000 })).toBe('ran');
    });

    it('serialises async callers in the same process', async () => {
      const file = path.join(dir, 'f.json');
      let active = 0;
      let maxActive = 0;
      const run = () => withFileLock(file, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
      await Promise.all([run(), run(), run(), run()]);
      expect(maxActive).toBe(1);
    });
  });

  describe('cross-process read-modify-write (no lost updates)', () => {
    const worker = path.resolve(__dirname, '..', 'fixtures', 'lockWorker.ts');
    const runWorker = (args: string[], env: Record<string, string> = {}) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', worker, ...args], {
          env: { ...process.env, ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`))));
      });

    it('4 processes x 25 locked increments yield exactly 100', async () => {
      const file = path.join(dir, 'counter.json');
      await Promise.all([0, 1, 2, 3].map((i) => runWorker(['counter', file, '25', `w${i}`])));
      expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ n: 100 });
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
      expect(leftovers()).toEqual([]);
    }, 60_000);

    it('addSchedule from 4 processes keeps every schedule', async () => {
      const file = path.join(dir, 'schedules.json');
      const env = { SCHEDULES_FILE: file, DATA_DIR: dir };
      await Promise.all([0, 1, 2, 3].map((i) => runWorker(['schedule', file, '10', `p${i}`], env)));
      const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as { schedules: Array<{ name: string }> };
      expect(store.schedules).toHaveLength(40);
      expect(new Set(store.schedules.map((s) => s.name)).size).toBe(40);
    }, 60_000);
  });
});
