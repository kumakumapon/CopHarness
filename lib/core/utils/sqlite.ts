/**
 * Shared SQLite plumbing used by MemoryStore and SearchIndex.
 */

export interface StatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

export interface DatabaseLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementLike;
  close: () => void;
}

export interface SqliteModuleLike {
  DatabaseSync: new (filename: string) => DatabaseLike;
}

/**
 * Attempt to load the node:sqlite built-in module.
 * Returns null if the module is unavailable or throws on require.
 * Callers are responsible for any env-var-based override (e.g. FORCE_JSON flags).
 */
export function loadSqlite(): SqliteModuleLike | null {
  try {
    const req = eval('require') as NodeRequire;
    return req('node:sqlite') as SqliteModuleLike;
  } catch {
    return null;
  }
}

/**
 * Escape a free-text query string for use with SQLite FTS5 MATCH expressions.
 * Each whitespace-separated token is wrapped in double quotes and joined with OR.
 */
export function escapeFtsQuery(raw: string): string {
  return raw
    .split(/\s+/)
    .map((token) => token.trim().replace(/"/g, ''))
    .filter(Boolean)
    .map((token) => `"${token}"`)
    .join(' OR ');
}
