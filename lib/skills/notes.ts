import { randomUUID } from 'node:crypto';
import { type SkillDefinition } from '../skill';
import { MemoryStore } from '../memory/store';

/**
 * Structured note management skill.
 * Notes are stored in the SQLite-backed MemoryStore as 'episodic' memory records.
 * Each note uses key='note:{uuid}' and subject=title, with tags encoded in content.
 * Inspired by the note-taking and diary skills in karaage0703/ai-assistant-workspace.
 */

function withStore<T>(fn: (store: MemoryStore) => T): T {
  const store = new MemoryStore();
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function noteKey(id: string): string {
  return `note:${id}`;
}

/** Encode tags and content into the stored content string. */
function encodeContent(tags: string[], content: string): string {
  if (tags.length === 0) return content;
  return `[tags: ${tags.join(', ')}]\n${content}`;
}

/** Decode tags and body from stored content string. */
function decodeContent(raw: string): { tags: string[]; body: string } {
  const match = raw.match(/^\[tags: ([^\]]*)\]\n([\s\S]*)$/);
  if (match) {
    const tags = match[1].split(',').map((t) => t.trim()).filter(Boolean);
    return { tags, body: match[2] };
  }
  return { tags: [], body: raw };
}

export const noteCreate: SkillDefinition = {
  name: 'noteCreate',
  description:
    'Creates a new note with a title, content, and optional tags. ' +
    'Notes are stored persistently in the SQLite memory store. ' +
    'Each note gets a unique ID and a creation timestamp. ' +
    'Use this to save meeting notes, ideas, diary entries, research summaries, etc.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Note title (short summary).' },
      content: { type: 'string', description: 'Note content (body text).' },
      tags: {
        type: 'string',
        description: 'Comma-separated tags for categorization (e.g., "work,idea,todo"). Optional.',
      },
    },
    required: ['title', 'content'],
  },
  category: 'memory',
  riskLevel: 'medium',
  handler: async (args) => {
    const title = String(args.title ?? '').trim();
    const content = String(args.content ?? '').trim();
    if (!title) return { content: 'Error: title is required', isError: true };
    if (!content) return { content: 'Error: content is required', isError: true };
    const tagsRaw = String(args.tags ?? '');
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    try {
      const id = randomUUID();
      const key = noteKey(id);
      const storedContent = encodeContent(tags, content);
      const record = withStore((store) =>
        store.upsert({
          key,
          kind: 'episodic',
          subject: title,
          content: storedContent,
        }),
      );
      const now = record.createdAt;
      return {
        content: [
          `✅ Note created (ID: ${id})`,
          `📝 Title: ${title}`,
          `🕐 Created: ${now.slice(0, 19).replace('T', ' ')}`,
          tags.length > 0 ? `🏷️ Tags: ${tags.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
      };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const noteRead: SkillDefinition = {
  name: 'noteRead',
  description:
    'Reads a note by its ID or searches for notes by keyword in the title or content. ' +
    'Returns the full note content.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Exact note ID to retrieve (from noteList or noteCreate output).' },
      keyword: { type: 'string', description: 'Keyword to search in note titles and content (case-insensitive).' },
    },
    required: [],
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async (args) => {
    const id = String(args.id ?? '').trim();
    const keyword = String(args.keyword ?? '').trim();
    if (!id && !keyword) {
      return { content: 'Error: provide either "id" or "keyword" to find a note.', isError: true };
    }
    try {
      const records = withStore((store) => {
        if (id) {
          const record = store.findByKey(noteKey(id));
          return record ? [record] : [];
        }
        return store.search({ query: keyword, kind: 'episodic', limit: 20 });
      });

      if (records.length === 0) {
        return { content: id ? `No note found with ID "${id}".` : `No notes matching "${keyword}".` };
      }

      const lines = records.map((record) => {
        const noteId = (record.key ?? '').replace(/^note:/, '');
        const { tags, body } = decodeContent(record.content);
        return [
          `## ${record.subject ?? '(no title)'}  (ID: ${noteId})`,
          `📅 Created: ${record.createdAt.slice(0, 19).replace('T', ' ')}`,
          tags.length > 0 ? `🏷️ Tags: ${tags.join(', ')}` : '',
          '',
          body,
        ].filter((l) => l !== '').join('\n');
      });
      return { content: lines.join('\n\n---\n\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const noteList: SkillDefinition = {
  name: 'noteList',
  description:
    'Lists all saved notes showing ID, title, tags, and creation date. ' +
    'Optionally filter by tag. ' +
    'Use noteRead to retrieve the full content of a specific note.',
  parameters: {
    type: 'object',
    properties: {
      tag: { type: 'string', description: 'Filter notes by tag (case-insensitive). Optional.' },
      limit: {
        type: 'number',
        description: 'Maximum number of notes to show (newest first). Defaults to 20.',
        minimum: 1,
        maximum: 100,
      },
    },
    required: [],
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async (args) => {
    const tag = String(args.tag ?? '').trim().toLowerCase();
    const limit = typeof args.limit === 'number' ? Math.min(100, Math.max(1, Math.floor(args.limit))) : 20;
    try {
      let records = withStore((store) =>
        store.search({ kind: 'episodic', limit: 100 }),
      ).filter((r) => (r.key ?? '').startsWith('note:'));

      if (tag) {
        records = records.filter((r) => {
          const { tags } = decodeContent(r.content);
          return tags.some((t) => t.toLowerCase() === tag);
        });
      }

      // Newest first (sort by createdAt descending)
      records = records
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);

      if (records.length === 0) {
        return { content: tag ? `No notes with tag "${tag}".` : '(no notes saved yet)' };
      }

      const lines = records.map((r) => {
        const noteId = (r.key ?? '').replace(/^note:/, '');
        const { tags } = decodeContent(r.content);
        const title = r.subject ?? '(no title)';
        return `[${noteId}] ${title}  📅 ${r.createdAt.slice(0, 10)}${tags.length > 0 ? `  🏷️ ${tags.join(', ')}` : ''}`;
      });
      return { content: `${records.length} note(s)${tag ? ` tagged "${tag}"` : ''}:\n\n${lines.join('\n')}` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const noteDelete: SkillDefinition = {
  name: 'noteDelete',
  description: 'Deletes a note permanently by its ID.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Note ID to delete.' },
    },
    required: ['id'],
  },
  category: 'memory',
  riskLevel: 'high',
  handler: async (args) => {
    const id = String(args.id ?? '').trim();
    if (!id) return { content: 'Error: id is required', isError: true };
    try {
      const key = noteKey(id);
      const record = withStore((store) => store.findByKey(key));
      if (!record) return { content: `No note found with ID "${id}".` };
      const title = record.subject ?? '(no title)';
      withStore((store) => store.forget(key));
      return { content: `🗑️ Deleted note "${title}" (ID: ${id}).` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
