/**
 * CLI Conversation Persistence.
 *
 * Saves and loads named CLI conversations to/from disk so that sessions can be
 * resumed after the CLI exits.  Each conversation is stored as a separate JSON
 * file under DATA_DIR/conversations/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { LLMMessage } from '../adapter';
import { dataPath, getDataDir } from '../utils/dataDir';

// ── Public types ─────────────────────────────────────────────────────────────

export interface SavedConversation {
  id: string;
  title: string;
  provider: string;
  model: string;
  messages: LLMMessage[];
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationListEntry {
  id: string;
  title: string;
  provider: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  /** First 100 chars of the last user message. */
  preview: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function conversationFilePath(id: string): string {
  return dataPath('conversations', `${id}.json`);
}

function conversationsDir(): string {
  return path.join(getDataDir(), 'conversations');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a title from the first user message (truncated to 50 chars).
 */
export function autoTitle(messages: LLMMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'Untitled conversation';
  const text = first.content.trim().replace(/\s+/g, ' ');
  return text.length > 50 ? text.slice(0, 50) : text;
}

/**
 * Save a conversation to disk.
 *
 * @param messages  The full message array to persist.
 * @param provider  Provider name (e.g. "openai").
 * @param model     Model name used in this session.
 * @param id        Optional existing ID – if supplied the file is overwritten.
 * @param title     Optional title; auto-generated from the first user message
 *                  when omitted.
 * @returns The conversation ID.
 */
export function saveConversation(
  messages: LLMMessage[],
  provider: string,
  model: string,
  id?: string,
  title?: string,
): string {
  const resolvedId = id ?? randomUUID();
  const filePath = conversationFilePath(resolvedId);

  let createdAt: string;
  // Preserve createdAt when updating an existing record.
  if (id && fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<SavedConversation>;
      createdAt = existing.createdAt ?? new Date().toISOString();
    } catch {
      createdAt = new Date().toISOString();
    }
  } else {
    createdAt = new Date().toISOString();
  }

  const resolvedTitle = title ?? autoTitle(messages);

  const record: SavedConversation = {
    id: resolvedId,
    title: resolvedTitle,
    provider,
    model,
    messages,
    createdAt,
    updatedAt: new Date().toISOString(),
    messageCount: messages.length,
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  return resolvedId;
}

/**
 * Load a saved conversation by ID.
 * Returns null if the ID does not exist or the file cannot be parsed.
 */
export function loadConversation(id: string): SavedConversation | null {
  const filePath = conversationFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SavedConversation;
  } catch {
    return null;
  }
}

/**
 * List all saved conversations, sorted by updatedAt descending.
 */
export function listConversations(): ConversationListEntry[] {
  const dir = conversationsDir();
  if (!fs.existsSync(dir)) return [];

  const entries: ConversationListEntry[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const fullPath = `${dir}/${file}`;
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const conv = JSON.parse(raw) as SavedConversation;

      // Build preview from the last user message.
      const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
      const preview = lastUser ? lastUser.content.trim().slice(0, 100) : '';

      entries.push({
        id: conv.id,
        title: conv.title,
        provider: conv.provider,
        model: conv.model,
        messageCount: conv.messageCount,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        preview,
      });
    } catch {
      // Skip malformed files.
    }
  }

  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Delete a saved conversation.
 * @returns true if the file was removed, false if it did not exist.
 */
export function deleteConversation(id: string): boolean {
  const filePath = conversationFilePath(id);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
