import * as path from 'node:path';
import { dataPath } from '../utils/dataDir';

export type MemoryKind = 'fact' | 'preference' | 'project' | 'task' | 'episodic';

export interface MemoryUpsertInput {
  id?: string;
  key?: string;
  kind?: MemoryKind;
  subject?: string;
  content: string;
  importance?: number;
  confidence?: number;
  sourceSessionId?: string;
  lastVerifiedAt?: Date | string;
  stale?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  key?: string;
  kind: MemoryKind;
  subject?: string;
  content: string;
  importance: number;
  confidence: number;
  sourceSessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  stale: boolean;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchQuery {
  query?: string;
  kind?: MemoryKind;
  subject?: string;
  stale?: boolean;
  limit?: number;
}

export interface MemorySearchResult extends MemoryRecord {
  rank?: number;
}

interface StatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface DatabaseLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementLike;
  close: () => void;
}

interface SqliteModuleLike {
  DatabaseSync: new (filename: string) => DatabaseLike;
}

const DEFAULT_MEMORY_DB = 'memory.sqlite';
const MEMORY_KINDS = new Set<MemoryKind>(['fact', 'preference', 'project', 'task', 'episodic']);

function loadSqlite(): SqliteModuleLike {
  const req = eval('require') as NodeRequire;
  return req('node:sqlite') as SqliteModuleLike;
}

export function getMemoryDbPath(): string {
  const raw = process.env.MEMORY_DB_FILE;
  if (raw && raw.trim()) return path.resolve(raw);
  return dataPath(DEFAULT_MEMORY_DB);
}

function normalizeKind(value: unknown): MemoryKind {
  const kind = String(value ?? 'fact').trim() as MemoryKind;
  return MEMORY_KINDS.has(kind) ? kind : 'fact';
}

function clampNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function toIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function makeId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toRecord(row: Record<string, unknown>): MemoryRecord {
  const metadataRaw = row.metadata_json ? String(row.metadata_json) : '';
  let metadata: Record<string, unknown> | undefined;
  if (metadataRaw) {
    try {
      metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: String(row.id),
    key: optionalString(row.key),
    kind: normalizeKind(row.kind),
    subject: optionalString(row.subject),
    content: String(row.content ?? ''),
    importance: Number(row.importance ?? 0.5),
    confidence: Number(row.confidence ?? 0.7),
    sourceSessionId: optionalString(row.source_session_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastVerifiedAt: optionalString(row.last_verified_at),
    stale: Number(row.stale ?? 0) === 1,
    metadata,
  };
}

function escapeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((token) => token.trim().replace(/"/g, ''))
    .filter(Boolean)
    .map((token) => `"${token}"`)
    .join(' OR ');
}

export class MemoryStore {
  private readonly db: DatabaseLike;

  constructor(filename = getMemoryDbPath()) {
    const sqlite = loadSqlite();
    this.db = new sqlite.DatabaseSync(filename);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  upsert(input: MemoryUpsertInput): MemoryRecord {
    const key = optionalString(input.key);
    const existing = input.id
      ? this.get(input.id)
      : key
        ? this.findByKey(key)
        : undefined;
    const now = new Date().toISOString();
    const id = existing?.id ?? input.id ?? makeId();
    const kind = normalizeKind(input.kind ?? existing?.kind);
    const content = String(input.content ?? '').trim();
    if (!content) throw new Error('memory content is required');

    const record: MemoryRecord = {
      id,
      key: key ?? existing?.key,
      kind,
      subject: optionalString(input.subject) ?? existing?.subject,
      content,
      importance: clampNumber(input.importance ?? existing?.importance, 0.5),
      confidence: clampNumber(input.confidence ?? existing?.confidence, 0.7),
      sourceSessionId: optionalString(input.sourceSessionId) ?? existing?.sourceSessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastVerifiedAt: toIso(input.lastVerifiedAt) ?? existing?.lastVerifiedAt,
      stale: input.stale ?? existing?.stale ?? false,
      metadata: input.metadata ?? existing?.metadata,
    };

    this.db.prepare(`
      INSERT INTO memories (
        id, key, kind, subject, content, importance, confidence, source_session_id,
        created_at, updated_at, last_verified_at, stale, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        key = excluded.key,
        kind = excluded.kind,
        subject = excluded.subject,
        content = excluded.content,
        importance = excluded.importance,
        confidence = excluded.confidence,
        source_session_id = excluded.source_session_id,
        updated_at = excluded.updated_at,
        last_verified_at = excluded.last_verified_at,
        stale = excluded.stale,
        metadata_json = excluded.metadata_json
    `).run(
      record.id,
      record.key ?? null,
      record.kind,
      record.subject ?? null,
      record.content,
      record.importance,
      record.confidence,
      record.sourceSessionId ?? null,
      record.createdAt,
      record.updatedAt,
      record.lastVerifiedAt ?? null,
      record.stale ? 1 : 0,
      record.metadata ? JSON.stringify(record.metadata) : null,
    );

    this.db.prepare('DELETE FROM memory_fts WHERE rowid = ?').run(this.rowId(record.id));
    this.db.prepare('INSERT INTO memory_fts(rowid, key, subject, content) VALUES (?, ?, ?, ?)').run(
      this.rowId(record.id),
      record.key ?? '',
      record.subject ?? '',
      record.content,
    );

    return record;
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : undefined;
  }

  findByKey(key: string): MemoryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE key = ?').get(key) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : undefined;
  }

  forget(idOrKey: string): boolean {
    const record = this.get(idOrKey) ?? this.findByKey(idOrKey);
    if (!record) return false;
    const rowId = this.rowId(record.id);
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(record.id);
    this.db.prepare('DELETE FROM memory_fts WHERE rowid = ?').run(rowId);
    return true;
  }

  search(query: MemorySearchQuery = {}): MemorySearchResult[] {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 10)));
    const filters: string[] = [];
    const params: unknown[] = [];

    if (query.kind) {
      filters.push('m.kind = ?');
      params.push(normalizeKind(query.kind));
    }
    if (query.subject) {
      filters.push('m.subject LIKE ?');
      params.push(`%${query.subject}%`);
    }
    if (query.stale !== undefined) {
      filters.push('m.stale = ?');
      params.push(query.stale ? 1 : 0);
    }

    const fts = optionalString(query.query);
    if (fts) {
      const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
      const rows = this.db.prepare(`
        SELECT m.*, bm25(memory_fts) AS rank
        FROM memory_fts
        JOIN memories m ON m._rowid = memory_fts.rowid
        WHERE memory_fts MATCH ? ${where}
        ORDER BY rank ASC, m.importance DESC, m.updated_at DESC
        LIMIT ?
      `).all(escapeFtsQuery(fts), ...params, limit) as Record<string, unknown>[];
      return rows.map((row) => ({ ...toRecord(row), rank: Number(row.rank ?? 0) }));
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM memories m
      ${where}
      ORDER BY m.importance DESC, m.updated_at DESC
      LIMIT ?
    `).all(...params, limit) as Record<string, unknown>[];
    return rows.map((row) => toRecord(row));
  }

  explain(idOrKey: string): string {
    const record = this.get(idOrKey) ?? this.findByKey(idOrKey);
    if (!record) return `(no memory found for "${idOrKey}")`;
    return [
      `Memory ${record.id}${record.key ? ` (${record.key})` : ''}`,
      `kind=${record.kind} importance=${record.importance} confidence=${record.confidence} stale=${record.stale}`,
      record.subject ? `subject=${record.subject}` : undefined,
      record.sourceSessionId ? `sourceSessionId=${record.sourceSessionId}` : undefined,
      record.lastVerifiedAt ? `lastVerifiedAt=${record.lastVerifiedAt}` : undefined,
      `updatedAt=${record.updatedAt}`,
      `content=${record.content}`,
    ].filter(Boolean).join('\n');
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS memories (
        _rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        key TEXT UNIQUE,
        kind TEXT NOT NULL,
        subject TEXT,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.7,
        source_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT,
        stale INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(subject);
      CREATE INDEX IF NOT EXISTS idx_memories_stale ON memories(stale);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(key, subject, content);
    `);
  }

  private rowId(id: string): number {
    const row = this.db.prepare('SELECT _rowid FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`memory row not found for ${id}`);
    return Number(row._rowid);
  }
}

export function createMemoryStore(): MemoryStore {
  return new MemoryStore();
}
