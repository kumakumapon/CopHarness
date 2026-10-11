/**
 * A JSON-file store that several processes (web server, CLI, Discord bot, ...) can share safely.
 *
 * - `read()` returns the parsed state, cached in memory but re-read whenever the file changed on
 *   disk (mtime / size / inode), so one process sees another's writes.
 * - `update(mutate)` runs a read-modify-write cycle under the cross-process file lock: it re-reads
 *   the file inside the lock, applies `mutate` to that fresh state and writes it back atomically.
 *   Concurrent updates (same or different process) are therefore never lost.
 *
 * `mutate` must be synchronous: it runs while the lock is held. If it throws, nothing is written.
 */

import * as fs from 'fs';
import {
  atomicWriteJson,
  atomicWriteJsonSync,
  readJsonFileSync,
  withFileLock,
  withFileLockSync,
  type FileLockOptions,
} from './jsonFile';

export interface SharedJsonStoreOptions<T> {
  /** Resolved on every call so env-controlled paths (tests) are honoured. */
  file: () => string;
  /** Turn whatever was parsed from disk (`{}` when the file is missing) into a valid state. */
  parse: (raw: unknown) => T;
  /** Convert the state into the value that is serialised (default: the state itself). */
  serialize?: (state: T) => unknown;
  lock?: FileLockOptions;
}

export interface SharedJsonStore<T> {
  read(): T;
  update<R>(mutate: (state: T) => R): Promise<R>;
  /**
   * Blocking variant of `update` for callers that must stay synchronous. Do not mix it with `update`
   * on the same store inside one process (the blocking lock would starve a pending async holder).
   */
  updateSync<R>(mutate: (state: T) => R): R;
  /** Drop the cache and the pending-update chain (tests). */
  reset(): void;
}

function signatureOf(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return 'missing';
  }
}

export function createSharedJsonStore<T>(options: SharedJsonStoreOptions<T>): SharedJsonStore<T> {
  let cache: { file: string; signature: string; state: T } | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  function load(file: string): T {
    const raw = readJsonFileSync<unknown>(file, () => ({}));
    try {
      return options.parse(raw);
    } catch {
      return options.parse({});
    }
  }

  function read(): T {
    const file = options.file();
    const signature = signatureOf(file);
    if (cache && cache.file === file && cache.signature === signature) return cache.state;
    // Load first, then take the signature of what was actually read (a corrupt file is moved aside while loading).
    const state = load(file);
    cache = { file, signature: signatureOf(file), state };
    return state;
  }

  function update<R>(mutate: (state: T) => R): Promise<R> {
    const run = async (): Promise<R> => {
      const file = options.file();
      return withFileLock(file, async () => {
        const state = load(file);
        const result = mutate(state);
        await atomicWriteJson(file, options.serialize ? options.serialize(state) : state);
        cache = { file, signature: signatureOf(file), state };
        return result;
      }, options.lock);
    };
    // Keep the chain alive after a failed update so one error cannot block every later write.
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  }

  function updateSync<R>(mutate: (state: T) => R): R {
    const file = options.file();
    return withFileLockSync(file, () => {
      const state = load(file);
      const result = mutate(state);
      atomicWriteJsonSync(file, options.serialize ? options.serialize(state) : state);
      cache = { file, signature: signatureOf(file), state };
      return result;
    }, options.lock);
  }

  return {
    read,
    update,
    updateSync,
    reset() {
      cache = null;
      chain = Promise.resolve();
    },
  };
}
