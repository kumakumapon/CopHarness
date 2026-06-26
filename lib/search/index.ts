/**
 * Full-text search index over conversation messages and TaskLedger tasks.
 *
 * Backend: SQLite FTS5 (node:sqlite DatabaseSync) with a JSON-array fallback,
 * mirroring the dual-backend approach used by MemoryStore.
 *
 * Env overrides:
 *   SEARCH_INDEX_FILE         — SQLite db path (overrides default DATA_DIR/search_index.sqlite)
 *   SEARCH_INDEX_FORCE_JSON   — 'true'|'1' forces JSON fallback
 *   SEARCH_INDEX_ENABLED      — 'false'|'0' disables indexing (no-ops on upsert/search)
 *
 * DATA_DIR is honoured via the shared dataPath() utility.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { dataPath } from '../utils/dataDir';
import { type StatementLike, type DatabaseLike, type SqliteModuleLike, loadSqlite, escapeFtsQuery } from '../utils/sqlite';
import type { LLMMessage } from '../adapter';
import type { TaskRecord } from '../tasks/ledger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SearchDocType = 'conversation' | 'task';

export interface SearchDocument {
  id: string;              // conversation: `${conversationKey}:${messageIndex}`; task: `task:${taskId}`
  type: SearchDocType;
  conversationKey?: string;
  role?: string;           // conversation messages
  taskId?: string;
  title?: string;          // task title / kind
  content: string;         // message content or task title+error+metadata text
  createdAt: string;       // ISO
}

export interface SearchHit extends SearchDocument {
  snippet: string;
}

export interface SearchQuery {
  query: string;
  type?: SearchDocType;
  conversationKey?: string;
  limit?: number;
}

const DEFAULT_SEARCH_DB = 'search_index.sqlite';
const DEFAULT_SEARCH_JSON = 'search_index.json';
const JSON_CAP = 5000;
const SNIPPET_LENGTH = 160;

export function isSearchIndexEnabled(): boolean {
  const v = process.env.SEARCH_INDEX_ENABLED;
  return v !== 'false' && v !== '0';
}

export function getSearchDbPath(): string {
  const raw = process.env.SEARCH_INDEX_FILE;
  if (raw && raw.trim()) return path.resolve(raw);
  return dataPath(DEFAULT_SEARCH_DB);
}

function getFallbackSearchFile(filename: string): string {
  if (process.env.SEARCH_INDEX_FILE) return `${filename}.json`;
  return dataPath(DEFAULT_SEARCH_JSON);
}

// ---------------------------------------------------------------------------
// Snippet generation
// ---------------------------------------------------------------------------

function makeSnippet(content: string, query: string): string {
  const lower = content.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  let matchPos = -1;
  for (const term of terms) {
    const pos = lower.indexOf(term);
    if (pos !== -1) {
      matchPos = pos;
      break;
    }
  }

  if (matchPos === -1) {
    return content.slice(0, SNIPPET_LENGTH) + (content.length > SNIPPET_LENGTH ? '…' : '');
  }

  const half = Math.floor(SNIPPET_LENGTH / 2);
  const start = Math.max(0, matchPos - half);
  const end = Math.min(content.length, start + SNIPPET_LENGTH);
  const snippet = content.slice(start, end);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToDoc(row: Record<string, unknown>): SearchDocument {
  return {
    id: String(row.id),
    type: (row.type as SearchDocType) ?? 'conversation',
    conversationKey: row.conversation_key ? String(row.conversation_key) : undefined,
    role: row.role ? String(row.role) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined,
    title: row.title ? String(row.title) : undefined,
    content: String(row.content ?? ''),
    createdAt: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// SearchIndex class
// ---------------------------------------------------------------------------

export class SearchIndex {
  private readonly db: DatabaseLike | null;
  private readonly fallbackFile: string | null;

  constructor(filename = getSearchDbPath()) {
    const forceJson = process.env.SEARCH_INDEX_FORCE_JSON === 'true' || process.env.SEARCH_INDEX_FORCE_JSON === '1';
    const sqlite = forceJson ? null : loadSqlite();
    if (sqlite) {
      this.db = new sqlite.DatabaseSync(filename);
      this.fallbackFile = null;
      this.migrate();
      return;
    }
    this.db = null;
    this.fallbackFile = getFallbackSearchFile(filename);
  }

  close(): void {
    this.db?.close();
  }

  /** Insert or replace a document by id. */
  upsert(doc: SearchDocument): void {
    if (!doc.id || !doc.content) return;

    if (!this.db) {
      this.upsertFallback(doc);
      return;
    }

    this.db.prepare(`
      INSERT INTO search_documents (
        id, type, conversation_key, role, task_id, title, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type             = excluded.type,
        conversation_key = excluded.conversation_key,
        role             = excluded.role,
        task_id          = excluded.task_id,
        title            = excluded.title,
        content          = excluded.content,
        created_at       = excluded.created_at
    `).run(
      doc.id,
      doc.type,
      doc.conversationKey ?? null,
      doc.role ?? null,
      doc.taskId ?? null,
      doc.title ?? null,
      doc.content,
      doc.createdAt,
    );

    // Keep FTS in sync: delete old entry then re-insert
    const rowId = this.getRowId(doc.id);
    if (rowId !== null) {
      this.db.prepare('DELETE FROM search_fts WHERE rowid = ?').run(rowId);
      this.db.prepare('INSERT INTO search_fts(rowid, content, title) VALUES (?, ?, ?)').run(
        rowId,
        doc.content,
        doc.title ?? '',
      );
    }
  }

  /** Full-text search, ranked by bm25 (sqlite) or naive token-match score (fallback). */
  search(query: SearchQuery): SearchHit[] {
    const limit = Math.min(20, Math.max(1, Number(query.limit ?? 10)));
    const q = query.query?.trim() ?? '';

    if (!this.db) return this.searchFallback(query, limit);

    const filters: string[] = [];
    const params: unknown[] = [];

    if (q) {
      params.push(escapeFtsQuery(q));
    }
    if (query.type) {
      filters.push('d.type = ?');
      params.push(query.type);
    }
    if (query.conversationKey) {
      filters.push('d.conversation_key = ?');
      params.push(query.conversationKey);
    }

    let rows: Record<string, unknown>[];
    if (q) {
      const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
      rows = this.db.prepare(`
        SELECT d.*, bm25(search_fts) AS rank
        FROM search_fts
        JOIN search_documents d ON d._rowid = search_fts.rowid
        WHERE search_fts MATCH ?
        ${where}
        ORDER BY rank ASC
        LIMIT ?
      `).all(...params, limit) as Record<string, unknown>[];
    } else {
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      rows = this.db.prepare(`
        SELECT d.*
        FROM search_documents d
        ${where}
        ORDER BY d.created_at DESC
        LIMIT ?
      `).all(...params, limit) as Record<string, unknown>[];
    }

    return rows.map((row) => ({
      ...rowToDoc(row),
      snippet: makeSnippet(String(row.content ?? ''), q),
    }));
  }

  /** Total number of indexed documents. */
  count(): number {
    if (!this.db) return this.loadFallback().length;
    const row = this.db.prepare('SELECT COUNT(*) as c FROM search_documents').get() as Record<string, unknown>;
    return Number(row.c ?? 0);
  }

  // ── Private: SQLite helpers ──────────────────────────────────────────────

  private getRowId(id: string): number | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT _rowid FROM search_documents WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? Number(row._rowid) : null;
  }

  private migrate(): void {
    if (!this.db) return;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS search_documents (
        _rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        conversation_key TEXT,
        role TEXT,
        task_id TEXT,
        title TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_search_type ON search_documents(type);
      CREATE INDEX IF NOT EXISTS idx_search_conv ON search_documents(conversation_key);
      CREATE INDEX IF NOT EXISTS idx_search_task ON search_documents(task_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(content, title);
    `);
  }

  // ── Private: JSON fallback ───────────────────────────────────────────────

  private upsertFallback(doc: SearchDocument): void {
    const docs = this.loadFallback();
    const next = docs.filter((d) => d.id !== doc.id);
    next.push(doc);
    // Cap at JSON_CAP — drop oldest by createdAt
    if (next.length > JSON_CAP) {
      next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      next.splice(0, next.length - JSON_CAP);
    }
    this.saveFallback(next);
  }

  private searchFallback(query: SearchQuery, limit: number): SearchHit[] {
    const q = query.query?.trim() ?? '';
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

    const filtered = this.loadFallback()
      .filter((d) => !query.type || d.type === query.type)
      .filter((d) => !query.conversationKey || d.conversationKey === query.conversationKey)
      .filter((d) => {
        if (terms.length === 0) return true;
        const haystack = `${d.title ?? ''} ${d.content}`.toLowerCase();
        return terms.some((term) => haystack.includes(term));
      });

    // Naive token-match scoring: count how many distinct terms appear
    const scored = filtered.map((d) => {
      const haystack = `${d.title ?? ''} ${d.content}`.toLowerCase();
      const score = terms.filter((t) => haystack.includes(t)).length;
      return { doc: d, score };
    });

    scored.sort((a, b) => b.score - a.score || b.doc.createdAt.localeCompare(a.doc.createdAt));

    return scored.slice(0, limit).map(({ doc }) => ({
      ...doc,
      snippet: makeSnippet(doc.content, q),
    }));
  }

  private loadFallback(): SearchDocument[] {
    if (!this.fallbackFile) return [];
    try {
      const raw = fs.readFileSync(this.fallbackFile, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as SearchDocument[];
    } catch {
      // File missing or corrupt
    }
    return [];
  }

  private saveFallback(docs: SearchDocument[]): void {
    if (!this.fallbackFile) return;
    fs.mkdirSync(path.dirname(this.fallbackFile), { recursive: true });
    fs.writeFileSync(this.fallbackFile, JSON.stringify(docs, null, 2), 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _instance: SearchIndex | null = null;

export function getSearchIndex(): SearchIndex {
  if (!_instance) _instance = new SearchIndex();
  return _instance;
}

/** Test helper: reset the singleton so env-controlled paths are re-read. */
export function _resetSearchIndexForTests(): void {
  try {
    _instance?.close();
  } catch {
    // ignore errors on close
  }
  _instance = null;
}

// ---------------------------------------------------------------------------
// Convenience helpers (used by hooks)
// ---------------------------------------------------------------------------

/**
 * Index new messages from a conversation.
 * Skips role === 'system'; starts from startIndex so callers only push new messages.
 * Never throws.
 */
export function indexConversationMessages(
  conversationKey: string,
  messages: LLMMessage[],
  startIndex: number,
): void {
  if (!isSearchIndexEnabled()) return;
  try {
    const index = getSearchIndex();
    for (let i = startIndex; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'system') continue;
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (!content) continue;
      const doc: SearchDocument = {
        id: `${conversationKey}:${i}`,
        type: 'conversation',
        conversationKey,
        role: msg.role,
        content,
        createdAt: new Date().toISOString(),
      };
      index.upsert(doc);
    }
  } catch (err) {
    console.warn('[search/index] indexConversationMessages failed:', err);
  }
}

/**
 * Index a TaskRecord.
 * content = [title, kind, status, errorPreview, ...metadata values].filter(Boolean).join(' ')
 * Never throws.
 */
export function indexTaskRecord(task: TaskRecord): void {
  if (!isSearchIndexEnabled()) return;
  try {
    const index = getSearchIndex();
    const metaValues = task.metadata
      ? Object.values(task.metadata)
          .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
          .filter(Boolean)
      : [];
    const content = [
      task.title,
      task.kind,
      task.status,
      task.errorPreview,
      ...metaValues,
    ]
      .filter(Boolean)
      .join(' ');

    const doc: SearchDocument = {
      id: `task:${task.id}`,
      type: 'task',
      taskId: task.id,
      title: task.title ?? task.kind,
      content: content || task.kind,
      createdAt: task.createdAt,
    };
    index.upsert(doc);
  } catch (err) {
    console.warn('[search/index] indexTaskRecord failed:', err);
  }
}
