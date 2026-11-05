/**
 * Sessions are append-only JSONL files in `<dataDir>/sessions/<id>.jsonl`.
 * The first line is a small header (so listing is cheap); later lines record
 * messages, compactions, setting changes and usage. Nothing is rewritten.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { PermissionMode } from '../config';
import { addUsage, emptyUsage, type Message, type TodoItem, type ToolSpec, type Usage } from '../types';

export interface SessionHeader {
  type: 'session';
  version: 2;
  id: string;
  title: string;
  createdAt: string;
  /** Who the session belongs to: "local", "web", "api:<subject>", "discord:<id>", "schedule:<id>"... */
  owner: string;
  /** Chat channel the session came from, if any. */
  channel?: string;
  model: string;
}

export type SessionRecord =
  | SessionHeader
  | { type: 'context'; system: string; tools: ToolSpec[] }
  | { type: 'message'; at: string; message: Message }
  | { type: 'compaction'; at: string; summary: Message; beforeTokens: number }
  | { type: 'meta'; at: string; model?: string; permissionMode?: PermissionMode; sessionAllow?: string[]; todos?: TodoItem[]; contextTokens?: number }
  | { type: 'usage'; at: string; model: string; usage: Usage; costUsd?: number };

export interface StoredSession {
  header: SessionHeader;
  system: string;
  tools: ToolSpec[];
  messages: Message[];
  /** Every message ever recorded, including those replaced by compaction (for display). */
  transcript: Array<Message | { compaction: true; at: string }>;
  model: string;
  permissionMode?: PermissionMode;
  sessionAllow: string[];
  todos: TodoItem[];
  contextTokens?: number;
  usage: Usage;
  costUsd: number;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  owner: string;
  channel?: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;

export function isValidSessionId(id: string): boolean {
  return ID_RE.test(id);
}

export class SessionStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'sessions');
  }

  private file(id: string): string {
    if (!isValidSessionId(id)) throw new Error(`不正なセッション ID です: ${id}`);
    return path.join(this.dir, `${id}.jsonl`);
  }

  exists(id: string): boolean {
    return isValidSessionId(id) && fs.existsSync(this.file(id));
  }

  async create(header: Omit<SessionHeader, 'type' | 'version'>, context: { system: string; tools: ToolSpec[] }): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lines = [{ type: 'session', version: 2, ...header }, { type: 'context', ...context }];
    await fsp.writeFile(this.file(header.id), lines.map(l => JSON.stringify(l)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  }

  async append(id: string, record: SessionRecord): Promise<void> {
    await fsp.appendFile(this.file(id), JSON.stringify(record) + '\n', { mode: 0o600 });
  }

  load(id: string): StoredSession | undefined {
    if (!this.exists(id)) return undefined;
    const file = this.file(id);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let header: SessionHeader | undefined;
    const s: Omit<StoredSession, 'header'> = {
      system: '', tools: [], messages: [], transcript: [], model: '', sessionAllow: [], todos: [],
      usage: emptyUsage(), costUsd: 0, updatedAt: fs.statSync(file).mtime.toISOString(),
    };
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec: SessionRecord;
      try { rec = JSON.parse(line); } catch { continue; } // a torn final line after a crash
      switch (rec.type) {
        case 'session': header = rec; s.model = rec.model; break;
        case 'context': s.system = rec.system; s.tools = rec.tools; break;
        case 'message': s.messages.push(rec.message); s.transcript.push(rec.message); break;
        case 'compaction': s.messages = [rec.summary]; s.transcript.push({ compaction: true, at: rec.at }); break;
        case 'meta':
          if (rec.model) s.model = rec.model;
          if (rec.permissionMode) s.permissionMode = rec.permissionMode;
          if (rec.sessionAllow) s.sessionAllow = rec.sessionAllow;
          if (rec.todos) s.todos = rec.todos;
          if (rec.contextTokens !== undefined) s.contextTokens = rec.contextTokens;
          break;
        case 'usage': s.usage = addUsage(s.usage, rec.usage); s.costUsd += rec.costUsd ?? 0; break;
      }
    }
    return header ? { header, ...s } : undefined;
  }

  private readHeader(file: string): SessionHeader | undefined {
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const first = buf.subarray(0, n).toString('utf8').split('\n')[0];
      const parsed = JSON.parse(first) as SessionHeader;
      return parsed.type === 'session' ? parsed : undefined;
    } catch {
      return undefined;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  list(filter: { owner?: string } = {}): SessionSummary[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: SessionSummary[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(this.dir, name);
      const h = this.readHeader(file);
      if (!h || (filter.owner && h.owner !== filter.owner)) continue;
      out.push({ id: h.id, title: h.title, owner: h.owner, channel: h.channel, model: h.model, createdAt: h.createdAt, updatedAt: fs.statSync(file).mtime.toISOString() });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<boolean> {
    if (!this.exists(id)) return false;
    await fsp.rm(this.file(id));
    return true;
  }
}
