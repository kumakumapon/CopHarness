/**
 * Safe persistence helpers for the JSON-file stores.
 *
 * - `atomicWriteFile*`: write to a temp file in the same directory, fsync, then
 *   rename over the target, so a crash mid-write can never leave a truncated
 *   file behind (readers see the old or the new content, never a mix).
 * - `readJsonFileSync`: a file that exists but cannot be parsed is moved aside
 *   to `<file>.corrupt-<timestamp>` with a loud warning instead of being
 *   silently treated as empty (which the next save would turn into data loss).
 * - `withFileLock*`: advisory cross-process lock (`<file>.lock`) so concurrent
 *   read-modify-write cycles from the server, CLI and Discord bot cannot lose
 *   each other's updates. Stale locks (dead pid / too old) are reclaimed.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

function tempPathFor(file: string): string {
  return `${file}.${process.pid}.${randomUUID()}.tmp`;
}

/** Windows can briefly refuse to rename over a file that is open elsewhere (AV, indexer, readers). */
const RENAME_RETRIABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 8;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Rename with a short retry on the transient errors Windows raises. `rename` is injectable for tests. */
export function renameWithRetrySync(
  from: string,
  to: string,
  rename: (a: string, b: string) => void = fs.renameSync,
  sleep: (ms: number) => void = sleepSync,
): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRIABLE.has(code)) throw err;
      sleep(10 * attempt);
    }
  }
}

/** Write `data` to `file` atomically (sync). Parent directories are created. */
export function atomicWriteFileSync(file: string, data: string, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tempPathFor(file);
  try {
    const fd = fs.openSync(tmp, 'w', mode);
    try {
      fs.writeFileSync(fd, data, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetrySync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already renamed or never created */ }
  }
}

/** Write `data` to `file` atomically (async). Parent directories are created. */
export async function atomicWriteFile(file: string, data: string, mode?: number): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = tempPathFor(file);
  try {
    const handle = await fsp.open(tmp, 'w', mode);
    try {
      await handle.writeFile(data, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        await fsp.rename(tmp, file);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRIABLE.has(code)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
      }
    }
  } finally {
    await fsp.unlink(tmp).catch(() => undefined);
  }
}

export function atomicWriteJsonSync(file: string, value: unknown, space: number | undefined = 2): void {
  atomicWriteFileSync(file, JSON.stringify(value, null, space) + '\n');
}

export async function atomicWriteJson(file: string, value: unknown, space: number | undefined = 2): Promise<void> {
  await atomicWriteFile(file, JSON.stringify(value, null, space) + '\n');
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Move an unparseable file aside so it is neither lost nor silently overwritten. */
export function quarantineCorruptFile(file: string, reason: unknown): string | undefined {
  const target = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const message = reason instanceof Error ? reason.message : String(reason);
  try {
    fs.renameSync(file, target);
    console.error(`[jsonFile] ${file} is not valid JSON (${message}); moved to ${target} and starting empty`);
    return target;
  } catch (err) {
    console.error(`[jsonFile] ${file} is not valid JSON (${message}) and could not be moved aside:`, err);
    return undefined;
  }
}

/**
 * Read and parse a JSON file.
 * - Missing file → `fallback()`.
 * - Invalid JSON → file is quarantined (see `quarantineCorruptFile`), then `fallback()`.
 * - Any other I/O error (e.g. permissions) is thrown: treating it as "empty" would
 *   let the next save overwrite data that is merely unreadable right now.
 */
export function readJsonFileSync<T>(file: string, fallback: () => T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    quarantineCorruptFile(file, err);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Cross-process lock
// ---------------------------------------------------------------------------

export interface FileLockOptions {
  /** Give up acquiring after this long. Default 5s. */
  timeoutMs?: number;
  /** A lock older than this is considered abandoned. Default 30s. */
  staleMs?: number;
}

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 10;

export class FileLockTimeoutError extends Error {
  constructor(file: string, timeoutMs: number, lastCode?: string) {
    super(`Timed out after ${timeoutMs}ms waiting for the lock on ${file}${lastCode ? ` (last error: ${lastCode})` : ''}`);
    this.name = 'FileLockTimeoutError';
  }
}

function lockPathFor(file: string): string {
  return `${file}.lock`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Remove the lock if its owner is gone or it is too old. Returns true if it was removed. */
function reclaimIfStale(lock: string, staleMs: number): boolean {
  try {
    const stat = fs.statSync(lock);
    let owner: { pid?: number } = {};
    try { owner = JSON.parse(fs.readFileSync(lock, 'utf-8')) as { pid?: number }; } catch { /* half-written */ }
    const ownerGone = typeof owner.pid === 'number' && owner.pid !== process.pid && !isProcessAlive(owner.pid);
    if (ownerGone || Date.now() - stat.mtimeMs > staleMs) {
      fs.unlinkSync(lock);
      return true;
    }
  } catch {
    return true; // vanished between EEXIST and stat: just retry
  }
  return false;
}

/**
 * Errors from `open(..., 'wx')` that mean "somebody else has it right now": the file exists, or
 * (Windows) another process is mid-delete / holds it open, which surfaces as EPERM/EACCES/EBUSY.
 * Retrying is correct for all of them; a genuinely unwritable directory ends in a timeout that
 * reports the last error code.
 */
const LOCK_BUSY_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

/** Try once to create the lock file. Returns the busy error code, or null when acquired. */
function tryAcquire(lock: string): string | null {
  try {
    const fd = fs.openSync(lock, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } finally { fs.closeSync(fd); }
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    if (LOCK_BUSY_CODES.has(code)) return code;
    throw err;
  }
}

/** Remove the lock file; retry briefly because Windows may refuse while another process is reading it. */
function release(lock: string): void {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      fs.unlinkSync(lock);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') return; // already reclaimed
      if (!LOCK_BUSY_CODES.has(code)) return;
      sleepSync(5);
    }
  }
}

/**
 * Run `fn` while holding the lock on `file`. Not re-entrant: calling this for the
 * same file from inside `fn` will wait until it times out. Do not mix the sync and
 * async variants on one file within a single process (the sync one blocks the event
 * loop while the async holder is waiting to release).
 *
 * Known limit: if two waiters both judge a crashed holder's lock stale at once, one may
 * delete the other's freshly created lock. That needs a crashed holder plus a simultaneous
 * reclaim, and the window is a few microseconds.
 */
export function withFileLockSync<T>(file: string, fn: () => T, options: FileLockOptions = {}): T {
  const { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS, staleMs = DEFAULT_LOCK_STALE_MS } = options;
  const lock = lockPathFor(file);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (let busy = tryAcquire(lock); busy !== null; busy = tryAcquire(lock)) {
    if (Date.now() > deadline) throw new FileLockTimeoutError(file, timeoutMs, busy);
    if (!reclaimIfStale(lock, staleMs)) sleepSync(LOCK_POLL_MS);
  }
  try {
    return fn();
  } finally {
    release(lock);
  }
}

/** Async variant of `withFileLockSync`. */
export async function withFileLock<T>(file: string, fn: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS, staleMs = DEFAULT_LOCK_STALE_MS } = options;
  const lock = lockPathFor(file);
  await fsp.mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (let busy = tryAcquire(lock); busy !== null; busy = tryAcquire(lock)) {
    if (Date.now() > deadline) throw new FileLockTimeoutError(file, timeoutMs, busy);
    if (!reclaimIfStale(lock, staleMs)) await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  try {
    return await fn();
  } finally {
    release(lock);
  }
}
