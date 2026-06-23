/**
 * Unit tests for lib/history/conversationPersistence
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Use an isolated temporary DATA_DIR for every test run.
const TMP_DIR = path.join(os.tmpdir(), `test-conv-persistence-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.DATA_DIR = TMP_DIR;
});

afterAll(() => {
  delete process.env.DATA_DIR;
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

beforeEach(() => {
  // Reset module registry so dataDir cache and module state are fresh.
  jest.resetModules();
  // Clean up the conversations sub-directory between tests.
  const convDir = path.join(TMP_DIR, 'conversations');
  if (fs.existsSync(convDir)) {
    for (const f of fs.readdirSync(convDir)) {
      fs.unlinkSync(path.join(convDir, f));
    }
  }
});

async function getPersistence() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../lib/history/conversationPersistence') as typeof import('../../lib/history/conversationPersistence');
}

// ── autoTitle ─────────────────────────────────────────────────────────────────

describe('autoTitle', () => {
  it('returns a truncated first user message (≤50 chars)', async () => {
    const { autoTitle } = await getPersistence();
    const messages = [
      { role: 'user' as const, content: 'Hello, how are you doing today?' },
      { role: 'assistant' as const, content: 'I am doing well!' },
    ];
    expect(autoTitle(messages)).toBe('Hello, how are you doing today?');
  });

  it('truncates long first user messages to 50 chars', async () => {
    const { autoTitle } = await getPersistence();
    const longContent = 'A'.repeat(80);
    const messages = [{ role: 'user' as const, content: longContent }];
    const title = autoTitle(messages);
    expect(title.length).toBe(50);
    expect(title).toBe('A'.repeat(50));
  });

  it('skips system messages and picks the first user message', async () => {
    const { autoTitle } = await getPersistence();
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'Tell me about TypeScript.' },
    ];
    expect(autoTitle(messages)).toBe('Tell me about TypeScript.');
  });

  it('returns fallback when no user message exists', async () => {
    const { autoTitle } = await getPersistence();
    const messages = [{ role: 'system' as const, content: 'System prompt.' }];
    expect(autoTitle(messages)).toBe('Untitled conversation');
  });

  it('returns fallback for empty message array', async () => {
    const { autoTitle } = await getPersistence();
    expect(autoTitle([])).toBe('Untitled conversation');
  });
});

// ── save + load roundtrip ─────────────────────────────────────────────────────

describe('saveConversation / loadConversation', () => {
  it('saves a conversation and loads it back', async () => {
    const { saveConversation, loadConversation } = await getPersistence();
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];
    const id = saveConversation(messages, 'openai', 'gpt-4o');

    const loaded = loadConversation(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(id);
    expect(loaded!.provider).toBe('openai');
    expect(loaded!.model).toBe('gpt-4o');
    expect(loaded!.messages).toEqual(messages);
    expect(loaded!.messageCount).toBe(2);
    expect(loaded!.title).toBe('Hello');
    expect(loaded!.createdAt).toBeTruthy();
    expect(loaded!.updatedAt).toBeTruthy();
  });

  it('uses the supplied title when provided', async () => {
    const { saveConversation, loadConversation } = await getPersistence();
    const messages = [{ role: 'user' as const, content: 'Some question' }];
    const id = saveConversation(messages, 'anthropic', 'claude-3', undefined, 'My Custom Title');
    const loaded = loadConversation(id);
    expect(loaded!.title).toBe('My Custom Title');
  });

  it('updates an existing conversation when the same id is used', async () => {
    const { saveConversation, loadConversation } = await getPersistence();
    const messages1 = [{ role: 'user' as const, content: 'First message' }];
    const id = saveConversation(messages1, 'openai', 'gpt-4o');

    // Small delay so updatedAt is different.
    await new Promise((r) => setTimeout(r, 5));

    const messages2 = [
      { role: 'user' as const, content: 'First message' },
      { role: 'assistant' as const, content: 'Reply' },
    ];
    saveConversation(messages2, 'openai', 'gpt-4o', id);

    const loaded = loadConversation(id);
    expect(loaded!.messageCount).toBe(2);
    expect(loaded!.messages).toEqual(messages2);
    // createdAt should be preserved; updatedAt should be newer or equal.
    expect(loaded!.updatedAt >= loaded!.createdAt).toBe(true);
  });

  it('uses the supplied id when one is provided', async () => {
    const { saveConversation, loadConversation } = await getPersistence();
    const messages = [{ role: 'user' as const, content: 'Test' }];
    const customId = 'my-custom-id-123';
    const returnedId = saveConversation(messages, 'openai', 'gpt-4', customId);
    expect(returnedId).toBe(customId);

    const loaded = loadConversation(customId);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(customId);
  });
});

describe('loadConversation', () => {
  it('returns null for a non-existent id', async () => {
    const { loadConversation } = await getPersistence();
    const result = loadConversation('does-not-exist-xyz');
    expect(result).toBeNull();
  });
});

// ── listConversations ─────────────────────────────────────────────────────────

describe('listConversations', () => {
  it('returns an empty array when no conversations are saved', async () => {
    const { listConversations } = await getPersistence();
    expect(listConversations()).toEqual([]);
  });

  it('lists all saved conversations', async () => {
    const { saveConversation, listConversations } = await getPersistence();
    saveConversation([{ role: 'user' as const, content: 'Msg A' }], 'openai', 'gpt-4');
    saveConversation([{ role: 'user' as const, content: 'Msg B' }], 'anthropic', 'claude-3');

    const list = listConversations();
    expect(list).toHaveLength(2);
  });

  it('sorts conversations by updatedAt descending', async () => {
    const { saveConversation, listConversations } = await getPersistence();

    saveConversation([{ role: 'user' as const, content: 'First' }], 'openai', 'gpt-4');
    await new Promise((r) => setTimeout(r, 5));
    saveConversation([{ role: 'user' as const, content: 'Second' }], 'openai', 'gpt-4');
    await new Promise((r) => setTimeout(r, 5));
    saveConversation([{ role: 'user' as const, content: 'Third' }], 'openai', 'gpt-4');

    const list = listConversations();
    expect(list).toHaveLength(3);
    // Most recently updated should be first.
    expect(list[0].updatedAt >= list[1].updatedAt).toBe(true);
    expect(list[1].updatedAt >= list[2].updatedAt).toBe(true);
    expect(list[0].title).toBe('Third');
  });

  it('includes a preview from the last user message (max 100 chars)', async () => {
    const { saveConversation, listConversations } = await getPersistence();
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'World' },
      { role: 'user' as const, content: 'Follow-up question here' },
    ];
    saveConversation(messages, 'openai', 'gpt-4');
    const list = listConversations();
    expect(list[0].preview).toBe('Follow-up question here');
  });

  it('truncates preview to 100 chars', async () => {
    const { saveConversation, listConversations } = await getPersistence();
    const longMsg = 'Q'.repeat(200);
    saveConversation([{ role: 'user' as const, content: longMsg }], 'openai', 'gpt-4');
    const list = listConversations();
    expect(list[0].preview.length).toBe(100);
  });
});

// ── deleteConversation ────────────────────────────────────────────────────────

describe('deleteConversation', () => {
  it('deletes a saved conversation and returns true', async () => {
    const { saveConversation, deleteConversation, loadConversation } = await getPersistence();
    const id = saveConversation([{ role: 'user' as const, content: 'Delete me' }], 'openai', 'gpt-4');

    const result = deleteConversation(id);
    expect(result).toBe(true);
    expect(loadConversation(id)).toBeNull();
  });

  it('returns false when the conversation does not exist', async () => {
    const { deleteConversation } = await getPersistence();
    expect(deleteConversation('nonexistent-id')).toBe(false);
  });

  it('removes the entry from the list after deletion', async () => {
    const { saveConversation, deleteConversation, listConversations } = await getPersistence();
    const id = saveConversation([{ role: 'user' as const, content: 'Hello' }], 'openai', 'gpt-4');
    saveConversation([{ role: 'user' as const, content: 'Other' }], 'openai', 'gpt-4');

    deleteConversation(id);
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Other');
  });
});
