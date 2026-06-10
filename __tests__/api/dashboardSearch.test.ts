/**
 * API tests for GET /api/dashboard/search
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-dsearch-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SEARCH_INDEX_FORCE_JSON = 'true';
  process.env.SEARCH_INDEX_FILE = path.join(tmpDir, 'test_search.json.placeholder');
  _resetDataDirCache();
  jest.resetModules();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.SEARCH_INDEX_FORCE_JSON;
  delete process.env.SEARCH_INDEX_FILE;
  delete process.env.COPHARNESS_API_KEY;
  delete process.env.SEARCH_INDEX_ENABLED;
  _resetDataDirCache();
  jest.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function getRoute() {
  // Reset search index singleton before loading route
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const searchMod = require('../../lib/search/index') as typeof import('../../lib/search/index');
  searchMod._resetSearchIndexForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const route = require('../../app/api/dashboard/search/route') as typeof import('../../app/api/dashboard/search/route');
  return { route, searchMod };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/dashboard/search', () => {
  it('returns empty result for empty query', async () => {
    const { route } = await getRoute();
    const res = await route.GET(makeRequest('http://localhost:3000/api/dashboard/search?q='));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hits).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('returns empty result when q param is absent', async () => {
    const { route } = await getRoute();
    const res = await route.GET(makeRequest('http://localhost:3000/api/dashboard/search'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hits).toEqual([]);
  });

  it('returns hits for a matching query', async () => {
    const { route, searchMod } = await getRoute();
    const idx = searchMod.getSearchIndex();
    idx.upsert({
      id: 'conv:0',
      type: 'conversation',
      conversationKey: 'line:U001',
      role: 'user',
      content: 'What is machine learning exactly?',
      createdAt: new Date().toISOString(),
    });

    const res = await route.GET(makeRequest('http://localhost:3000/api/dashboard/search?q=machine+learning'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.hits[0].id).toBe('conv:0');
  });

  it('type filter returns only task hits', async () => {
    const { route, searchMod } = await getRoute();
    const idx = searchMod.getSearchIndex();
    idx.upsert({
      id: 'conv:x',
      type: 'conversation',
      content: 'banana conversation message',
      createdAt: new Date().toISOString(),
    });
    idx.upsert({
      id: 'task:y',
      type: 'task',
      content: 'banana task record',
      createdAt: new Date().toISOString(),
    });

    const res = await route.GET(makeRequest('http://localhost:3000/api/dashboard/search?q=banana&type=task'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hits).toHaveLength(1);
    expect(data.hits[0].type).toBe('task');
  });

  it('requires API key when COPHARNESS_API_KEY is set', async () => {
    process.env.COPHARNESS_API_KEY = 'secret123';
    const { route } = await getRoute();
    const res = await route.GET(makeRequest('http://localhost:3000/api/dashboard/search?q=test'));
    expect(res.status).toBe(401);
  });

  it('accepts request with correct Authorization header', async () => {
    process.env.COPHARNESS_API_KEY = 'secret123';
    const { route } = await getRoute();
    const req = new NextRequest('http://localhost:3000/api/dashboard/search?q=hello', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret123' },
    });
    const res = await route.GET(req);
    expect(res.status).toBe(200);
  });

  it('returns empty when SEARCH_INDEX_ENABLED=false', async () => {
    process.env.SEARCH_INDEX_ENABLED = 'false';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const searchMod = require('../../lib/search/index') as typeof import('../../lib/search/index');
    searchMod._resetSearchIndexForTests();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const route = require('../../app/api/dashboard/search/route') as typeof import('../../app/api/dashboard/search/route');

    const res = await route.GET(makeRequest('http://localhost:3000/api/dashboard/search?q=anything'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hits).toEqual([]);
  });
});
