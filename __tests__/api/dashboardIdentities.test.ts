import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/dashboard/identities/route';
import { _resetIdentityStoreForTests, linkIdentity, resolveIdentity } from '../../lib/identity/store';
import { _resetTaskLedgerForTests, finishTask, startTask } from '../../lib/tasks/ledger';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

describe('GET /api/dashboard/identities', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-dashboard-identities-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetIdentityStoreForTests();
    _resetTaskLedgerForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.COPHARNESS_API_KEY;
    _resetDataDirCache();
    _resetIdentityStoreForTests();
    _resetTaskLedgerForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRequest(url = 'http://localhost:3000/api/dashboard/identities') {
    return new NextRequest(url, { method: 'GET' });
  }

  it('returns people with linked channels and recent tasks', async () => {
    const line = await resolveIdentity('line', 'user-1', { displayName: 'Ada' });
    await linkIdentity(line.personId, 'discord', 'discord-1', 'Ada Lovelace');
    const done = await startTask({ kind: 'api', personId: line.personId, channelKey: 'api:ada' });
    await finishTask(done.id, 'succeeded');
    const running = await startTask({
      kind: 'conversation',
      personId: line.personId,
      channelKey: line.channelKey,
      conversationKey: `person:${line.personId}`,
      title: 'ongoing request',
    });

    const res = await GET(makeRequest('http://localhost:3000/api/dashboard/identities?recentTaskLimit=1'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(1);
    expect(data.people[0]).toMatchObject({
      personId: line.personId,
      channelCount: 2,
      taskCount: 2,
      runningTaskCount: 1,
    });
    expect(data.people[0].channelIdentities.map((identity: { channelKey: string }) => identity.channelKey).sort()).toEqual([
      'discord:discord-1',
      'line:user-1',
    ]);
    expect(data.people[0].recentTasks).toHaveLength(1);
    expect(data.people[0].recentTasks[0].id).toBe(running.id);
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });
});
