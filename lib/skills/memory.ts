/**
 * Long-term memory skills backed by SQLite + FTS5.
 *
 * MEMORY_DB_FILE can point at a custom SQLite database. Otherwise the store uses
 * DATA_DIR/memory.sqlite. The legacy memorySet/memoryGet/memoryList skill names
 * are kept as compatibility wrappers over MemoryStore key records.
 */

import { type SkillDefinition } from '../skill';
import { MemoryStore, type MemoryKind } from '../memory/store';

function withStore<T>(fn: (store: MemoryStore) => T): T {
  const store = new MemoryStore();
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function parseKind(value: unknown): MemoryKind {
  const raw = String(value ?? 'fact');
  if (['fact', 'preference', 'project', 'task', 'episodic'].includes(raw)) return raw as MemoryKind;
  return 'fact';
}

function formatRecord(record: { id: string; key?: string; kind: string; subject?: string; content: string; confidence: number; importance: number; stale: boolean; updatedAt: string }): string {
  const label = record.key ? `${record.key} (${record.id})` : record.id;
  const subject = record.subject ? ` subject=${record.subject}` : '';
  return `- ${label} [${record.kind}${subject}, importance=${record.importance}, confidence=${record.confidence}, stale=${record.stale}, updated=${record.updatedAt}]: ${record.content}`;
}

export const memoryUpsert: SkillDefinition = {
  name: 'memoryUpsert',
  description: 'Creates or updates a long-term memory record with kind, source, confidence, importance, freshness, and searchable content.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Optional existing memory id to update.' },
      key: { type: 'string', description: 'Optional stable key for compatibility and direct lookup.' },
      kind: { type: 'string', enum: ['fact', 'preference', 'project', 'task', 'episodic'], description: 'Memory category.' },
      subject: { type: 'string', description: 'Person, project, or topic this memory is about.' },
      content: { type: 'string', description: 'Memory content to store.' },
      importance: { type: 'number', minimum: 0, maximum: 1, description: 'Importance from 0 to 1.' },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence from 0 to 1.' },
      sourceSessionId: { type: 'string', description: 'Source conversation/session/task id.' },
      lastVerifiedAt: { type: 'string', description: 'ISO timestamp when this memory was last verified.' },
      stale: { type: 'boolean', description: 'Whether the memory is known or suspected to be stale.' },
    },
    required: ['content'],
  },
  category: 'memory',
  riskLevel: 'medium',
  handler: async (args) => {
    const content = String(args.content ?? '').trim();
    if (!content) return { content: 'Error: content is required', isError: true };
    try {
      const record = withStore((store) => store.upsert({
        id: String(args.id ?? '').trim() || undefined,
        key: String(args.key ?? '').trim() || undefined,
        kind: parseKind(args.kind),
        subject: String(args.subject ?? '').trim() || undefined,
        content,
        importance: args.importance === undefined ? undefined : Number(args.importance),
        confidence: args.confidence === undefined ? undefined : Number(args.confidence),
        sourceSessionId: String(args.sourceSessionId ?? '').trim() || undefined,
        lastVerifiedAt: String(args.lastVerifiedAt ?? '').trim() || undefined,
        stale: args.stale === undefined ? undefined : Boolean(args.stale),
      }));
      return { content: `Saved memory ${record.id}${record.key ? ` (key=${record.key})` : ''}` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memorySearch: SkillDefinition = {
  name: 'memorySearch',
  description: 'Searches long-term memory using SQLite FTS5 with optional kind, subject, and stale filters.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Full-text search query. If omitted, recent important memories are returned.' },
      kind: { type: 'string', enum: ['fact', 'preference', 'project', 'task', 'episodic'], description: 'Optional memory category filter.' },
      subject: { type: 'string', description: 'Optional subject filter.' },
      stale: { type: 'boolean', description: 'Optional stale/fresh filter.' },
      limit: { type: 'number', minimum: 1, maximum: 100, description: 'Maximum number of records to return.' },
    },
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async (args) => {
    try {
      const records = withStore((store) => store.search({
        query: String(args.query ?? '').trim() || undefined,
        kind: args.kind ? parseKind(args.kind) : undefined,
        subject: String(args.subject ?? '').trim() || undefined,
        stale: args.stale === undefined ? undefined : Boolean(args.stale),
        limit: args.limit === undefined ? undefined : Number(args.limit),
      }));
      if (records.length === 0) return { content: '(no matching memories)' };
      return { content: records.map(formatRecord).join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memoryForget: SkillDefinition = {
  name: 'memoryForget',
  description: 'Deletes a long-term memory by id or key.',
  parameters: {
    type: 'object',
    properties: {
      idOrKey: { type: 'string', description: 'Memory id or stable key to delete.' },
    },
    required: ['idOrKey'],
  },
  category: 'memory',
  riskLevel: 'medium',
  handler: async (args) => {
    const idOrKey = String(args.idOrKey ?? '').trim();
    if (!idOrKey) return { content: 'Error: idOrKey is required', isError: true };
    try {
      const deleted = withStore((store) => store.forget(idOrKey));
      return { content: deleted ? `Forgot memory ${idOrKey}` : `(no memory found for "${idOrKey}")` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memoryExplain: SkillDefinition = {
  name: 'memoryExplain',
  description: 'Explains a memory record, including kind, confidence, importance, source, freshness, and content.',
  parameters: {
    type: 'object',
    properties: {
      idOrKey: { type: 'string', description: 'Memory id or stable key to explain.' },
    },
    required: ['idOrKey'],
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async (args) => {
    const idOrKey = String(args.idOrKey ?? '').trim();
    if (!idOrKey) return { content: 'Error: idOrKey is required', isError: true };
    try {
      return { content: withStore((store) => store.explain(idOrKey)) };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memorySet: SkillDefinition = {
  name: 'memorySet',
  description: 'Compatibility wrapper that saves a key-value pair into the SQLite long-term memory store.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key to store the value under.' },
      value: { type: 'string', description: 'The value to store.' },
    },
    required: ['key', 'value'],
  },
  category: 'memory',
  riskLevel: 'medium',
  handler: async (args) => {
    const key = String(args.key ?? '').trim();
    const value = String(args.value ?? '');
    if (!key) return { content: 'Error: key is required', isError: true };
    try {
      withStore((store) => store.upsert({ key, kind: 'fact', content: value }));
      return { content: `Saved: "${key}" = "${value}"` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memoryGet: SkillDefinition = {
  name: 'memoryGet',
  description: 'Retrieves the value stored under a key from SQLite long-term memory.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key to look up.' },
    },
    required: ['key'],
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async (args) => {
    const key = String(args.key ?? '').trim();
    if (!key) return { content: 'Error: key is required', isError: true };
    try {
      const record = withStore((store) => store.findByKey(key));
      if (!record) return { content: `(no value stored for key "${key}")` };
      return { content: record.content };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memoryList: SkillDefinition = {
  name: 'memoryList',
  description: 'Lists recent important records in SQLite long-term memory.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async () => {
    try {
      const records = withStore((store) => store.search({ limit: 100 }));
      if (records.length === 0) return { content: '(memory is empty)' };
      return { content: records.map((record) => record.key ? `"${record.key}": "${record.content}"` : formatRecord(record)).join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
