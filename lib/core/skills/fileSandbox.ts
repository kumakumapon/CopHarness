/**
 * Shared security utilities for file-system skills.
 *
 * All file operations are sandboxed to a single directory.
 * The directory is configured via SKILL_FILE_SANDBOX_DIR (defaults to ./workspace).
 * Any path that resolves outside the sandbox directory is rejected.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

/** Resolve and return the absolute sandbox directory path, creating it if needed. */
export async function getSandboxDir(): Promise<string> {
  const raw = process.env.SKILL_FILE_SANDBOX_DIR ?? './workspace';
  const dir = path.resolve(raw);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a user-supplied relative or absolute path to an absolute path inside the sandbox.
 * Throws if the resolved path escapes the sandbox directory.
 */
export async function resolveSafe(userPath: string): Promise<string> {
  const sandbox = await getSandboxDir();
  // Strip leading slashes so joining doesn't treat it as absolute
  const stripped = userPath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(sandbox, stripped);
  if (!resolved.startsWith(sandbox + path.sep) && resolved !== sandbox) {
    throw new Error(`Path "${userPath}" is outside the allowed sandbox directory.`);
  }
  return resolved;
}
