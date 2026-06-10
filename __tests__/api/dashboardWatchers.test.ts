import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/dashboard/watchers/route';
import { PATCH } from '../../app/api/dashboard/watchers/[id]/route';
import { POST as POST_WATCHER_EVENT } from '../../app/api/watchers/events/route';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

describe('dashboard watchers API', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-dashboard-watchers-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.COPHARNESS_API_KEY;
    _resetDataDirCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function request(
    url = 'http://localhost:3000/api/dashboard/watchers',
    init: ConstructorParameters<typeof NextRequest>[1] = {},
  ) {
    return new NextRequest(url, init);
  }

  it('creates and lists watchers', async () => {
    const created = await POST(request('http://localhost:3000/api/dashboard/watchers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Manual watcher', type: 'manual', prompt: 'Run a check' }),
    }));

    expect(created.status).toBe(201);
    const createdData = await created.json() as { watcher: { id: string } };
    expect(createdData.watcher.id).toMatch(/^watcher_/);

    const listed = await GET(request());
    const listedData = await listed.json() as { watchers: Array<{ name: string }> };
    expect(listedData.watchers).toHaveLength(1);
    expect(listedData.watchers[0].name).toBe('Manual watcher');
  });

  it('updates watcher enabled state', async () => {
    const created = await POST(request('http://localhost:3000/api/dashboard/watchers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Webhook watcher', prompt: 'Run a check' }),
    }));
    const { watcher } = await created.json() as { watcher: { id: string } };

    const updated = await PATCH(
      request(`http://localhost:3000/api/dashboard/watchers/${watcher.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ id: watcher.id }) },
    );

    expect(updated.status).toBe(200);
    const data = await updated.json() as { watcher: { enabled: boolean } };
    expect(data.watcher.enabled).toBe(false);
  });

  it('requires API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it('accepts external watcher events and reports match count', async () => {
    await POST(request('http://localhost:3000/api/dashboard/watchers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'GitHub watcher',
        type: 'github',
        prompt: 'Summarize the issue',
        eventPattern: 'opened',
      }),
    }));

    const unmatched = await POST_WATCHER_EVENT(request('http://localhost:3000/api/watchers/events', {
      method: 'POST',
      body: JSON.stringify({ source: 'webhook', subject: 'opened issue' }),
    }));

    expect(unmatched.status).toBe(200);
    const data = await unmatched.json() as { matched: number; failed: number };
    expect(data).toMatchObject({ matched: 0, failed: 0 });
  });

  it('validates external watcher event source', async () => {
    const res = await POST_WATCHER_EVENT(request('http://localhost:3000/api/watchers/events', {
      method: 'POST',
      body: JSON.stringify({ subject: 'missing source' }),
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'source (string) is required' });
  });
});
