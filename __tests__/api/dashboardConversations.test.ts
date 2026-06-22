/**
 * Tests for the Conversation Export API endpoints:
 *   GET  /api/dashboard/conversations
 *   GET  /api/dashboard/conversations/[key]
 *   DELETE /api/dashboard/conversations/[key]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';

const TMP_HISTORY_FILE = path.join(os.tmpdir(), `test-dash-conversations-${process.pid}.json`);

beforeAll(() => {
  process.env.CONVERSATION_HISTORY_FILE = TMP_HISTORY_FILE;
});

afterAll(() => {
  delete process.env.CONVERSATION_HISTORY_FILE;
  delete process.env.COPHARNESS_API_KEY;
  try {
    fs.unlinkSync(TMP_HISTORY_FILE);
  } catch {
    // ignore
  }
});

beforeEach(() => {
  jest.resetModules();
  if (fs.existsSync(TMP_HISTORY_FILE)) fs.unlinkSync(TMP_HISTORY_FILE);
  delete process.env.COPHARNESS_API_KEY;
});

// Dynamic imports so the history store singleton is freshly initialised per test
async function getListRoute() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../app/api/dashboard/conversations/route') as typeof import('../../app/api/dashboard/conversations/route');
}

async function getKeyRoute() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../app/api/dashboard/conversations/[key]/route') as typeof import('../../app/api/dashboard/conversations/[key]/route');
}

async function getStore() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../lib/history/store') as typeof import('../../lib/history/store');
}

function makeGetRequest(url: string) {
  return new NextRequest(url, { method: 'GET' });
}

function makeDeleteRequest(url: string) {
  return new NextRequest(url, { method: 'DELETE' });
}

describe('GET /api/dashboard/conversations', () => {
  it('returns empty conversations array when no history exists', async () => {
    const { GET } = await getListRoute();
    const req = makeGetRequest('http://localhost:3000/api/dashboard/conversations');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ conversations: [] });
  });

  it('returns list of conversation sessions with correct metadata', async () => {
    const { saveHistory } = await getStore();
    await saveHistory('line:U001', [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]);
    await saveHistory('discord:C999', [{ role: 'user', content: 'world' }]);

    const { GET } = await getListRoute();
    const req = makeGetRequest('http://localhost:3000/api/dashboard/conversations');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.conversations).toHaveLength(2);
    const entry1 = (data.conversations as { key: string; messageCount: number }[]).find((e) => e.key === 'line:U001');
    const entry2 = (data.conversations as { key: string; messageCount: number }[]).find((e) => e.key === 'discord:C999');
    expect(entry1).toBeDefined();
    expect(entry1!.messageCount).toBe(2);
    expect(entry2).toBeDefined();
    expect(entry2!.messageCount).toBe(1);
  });

  it('respects the ?limit= query parameter', async () => {
    const { saveHistory } = await getStore();
    for (let i = 0; i < 5; i++) {
      await saveHistory(`key:${i}`, [{ role: 'user', content: `msg ${i}` }]);
    }

    const { GET } = await getListRoute();
    const req = makeGetRequest('http://localhost:3000/api/dashboard/conversations?limit=3');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversations).toHaveLength(3);
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const { GET } = await getListRoute();
    const req = makeGetRequest('http://localhost:3000/api/dashboard/conversations');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/dashboard/conversations/[key]', () => {
  it('returns full messages for an existing conversation', async () => {
    const { saveHistory } = await getStore();
    const messages = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi there' },
    ];
    await saveHistory('line:TEST_KEY', messages);

    const { GET } = await getKeyRoute();
    const req = makeGetRequest('http://localhost:3000/api/dashboard/conversations/line%3ATEST_KEY');
    const res = await GET(req, { params: Promise.resolve({ key: 'line:TEST_KEY' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.key).toBe('line:TEST_KEY');
    expect(data.messages).toEqual(messages);
    expect(typeof data.exportedAt).toBe('string');
  });

  it('returns 404 when the conversation key does not exist', async () => {
    const { GET } = await getKeyRoute();
    const req = makeGetRequest('http://localhost:3000/api/dashboard/conversations/nonexistent');
    const res = await GET(req, { params: Promise.resolve({ key: 'nonexistent' }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const { GET } = await getKeyRoute();
    const req = makeGetRequest('http://localhost:3000/api/dashboard/conversations/some-key');
    const res = await GET(req, { params: Promise.resolve({ key: 'some-key' }) });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/dashboard/conversations/[key]', () => {
  it('clears the conversation and returns ok', async () => {
    const { saveHistory, loadHistory } = await getStore();
    await saveHistory('line:DEL_ME', [{ role: 'user', content: 'bye' }]);

    const { DELETE } = await getKeyRoute();
    const req = makeDeleteRequest('http://localhost:3000/api/dashboard/conversations/line%3ADEL_ME');
    const res = await DELETE(req, { params: Promise.resolve({ key: 'line:DEL_ME' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });

    // Verify the history is actually cleared
    expect(loadHistory('line:DEL_ME')).toEqual([]);
  });

  it('returns ok even for a non-existent key (no-op)', async () => {
    const { DELETE } = await getKeyRoute();
    const req = makeDeleteRequest('http://localhost:3000/api/dashboard/conversations/does-not-exist');
    const res = await DELETE(req, { params: Promise.resolve({ key: 'does-not-exist' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const { DELETE } = await getKeyRoute();
    const req = makeDeleteRequest('http://localhost:3000/api/dashboard/conversations/some-key');
    const res = await DELETE(req, { params: Promise.resolve({ key: 'some-key' }) });
    expect(res.status).toBe(401);
  });
});
