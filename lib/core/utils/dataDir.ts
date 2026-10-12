/**
 * DATA_DIR utility.
 *
 * Resolves the base directory for all persistent data files
 * (conversation history, schedules, execution logs, transcripts).
 *
 * Priority:
 *   1. `DATA_DIR` environment variable (explicit override)
 *   2. Current working directory (legacy default)
 *
 * When DATA_DIR is set the directory is created on first access if it does not
 * already exist.
 */

import * as fs from 'fs';
import * as path from 'path';

let _resolvedDir: string | null = null;

/**
 * Return the resolved data directory path.
 * The directory is created (recursively) if it does not exist.
 */
export function getDataDir(): string {
  if (_resolvedDir !== null) return _resolvedDir;

  const raw = process.env.DATA_DIR;
  const dir = raw ? path.resolve(raw) : process.cwd();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _resolvedDir = dir;
  return dir;
}

/**
 * Resolve a file path relative to the data directory.
 * Parent directories are created if they do not exist.
 *
 * @example
 *   dataPath('schedules.json')        // → <DATA_DIR>/schedules.json
 *   dataPath('transcripts/2024-01')   // → <DATA_DIR>/transcripts/2024-01
 */
export function dataPath(...segments: string[]): string {
  const full = path.join(getDataDir(), ...segments);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return full;
}

/** Reset the cached resolved directory (useful in tests). */
export function _resetDataDirCache(): void {
  _resolvedDir = null;
}
