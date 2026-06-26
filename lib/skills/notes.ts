import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { type SkillDefinition } from '../skill';
import { dataPath } from '../utils/dataDir';

/**
 * Structured note management skill.
 * Notes are stored as timestamped JSON entries in a file (SKILL_NOTES_FILE, default: ./notes.json).
 * Inspired by the note-taking and diary skills in karaage0703/ai-assistant-workspace.
 */

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

function getNotesFile(): string {
  if (process.env.SKILL_NOTES_FILE) return path.resolve(process.env.SKILL_NOTES_FILE);
  return dataPath('notes.json');
}

async function loadNotes(): Promise<Note[]> {
  const file = getNotesFile();
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as Note[];
  } catch {
    return [];
  }
}

async function saveNotes(notes: Note[]): Promise<void> {
  const file = getNotesFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(notes, null, 2), 'utf8');
}

function generateId(): string {
  return randomUUID();
}

export const noteCreate: SkillDefinition = {
  name: 'noteCreate',
  description:
    'Creates a new note with a title, content, and optional tags. ' +
    'Notes are stored persistently in SKILL_NOTES_FILE (default: ./notes.json). ' +
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
      const notes = await loadNotes();
      const now = new Date().toISOString();
      const note: Note = {
        id: generateId(),
        title,
        content,
        tags,
        createdAt: now,
        updatedAt: now,
      };
      notes.push(note);
      await saveNotes(notes);
      return {
        content: [
          `✅ Note created (ID: ${note.id})`,
          `📝 Title: ${note.title}`,
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
    const keyword = String(args.keyword ?? '').trim().toLowerCase();
    if (!id && !keyword) {
      return { content: 'Error: provide either "id" or "keyword" to find a note.', isError: true };
    }
    try {
      const notes = await loadNotes();
      let found: Note[];
      if (id) {
        found = notes.filter((n) => n.id === id);
      } else {
        found = notes.filter(
          (n) => n.title.toLowerCase().includes(keyword) || n.content.toLowerCase().includes(keyword),
        );
      }
      if (found.length === 0) {
        return { content: id ? `No note found with ID "${id}".` : `No notes matching "${keyword}".` };
      }
      const lines = found.map((n) => [
        `## ${n.title}  (ID: ${n.id})`,
        `📅 Created: ${n.createdAt.slice(0, 19).replace('T', ' ')}`,
        n.tags.length > 0 ? `🏷️ Tags: ${n.tags.join(', ')}` : '',
        '',
        n.content,
      ].filter((l) => l !== '').join('\n'));
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
      let notes = await loadNotes();
      if (tag) {
        notes = notes.filter((n) => n.tags.some((t) => t.toLowerCase() === tag));
      }
      // Show newest first
      notes = notes.slice().reverse().slice(0, limit);
      if (notes.length === 0) {
        return { content: tag ? `No notes with tag "${tag}".` : '(no notes saved yet)' };
      }
      const lines = notes.map(
        (n) =>
          `[${n.id}] ${n.title}  📅 ${n.createdAt.slice(0, 10)}${n.tags.length > 0 ? `  🏷️ ${n.tags.join(', ')}` : ''}`,
      );
      return { content: `${notes.length} note(s)${tag ? ` tagged "${tag}"` : ''}:\n\n${lines.join('\n')}` };
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
      const notes = await loadNotes();
      const idx = notes.findIndex((n) => n.id === id);
      if (idx === -1) return { content: `No note found with ID "${id}".` };
      const [deleted] = notes.splice(idx, 1);
      await saveNotes(notes);
      return { content: `🗑️ Deleted note "${deleted.title}" (ID: ${id}).` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
