import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/dashboard/tasks/route';
import { _resetTaskLedgerForTests, finishTask, startTask } from '../../lib/tasks/ledger';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

describe('GET /api/dashboard/tasks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-dashboard-tasks-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.COPHARNESS_API_KEY;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRequest(url = 'http://localhost:3000/api/dashboard/tasks') {
    return new NextRequest(url, { method: 'GET' });
  }

  it('returns filtered TaskLedger records for the dashboard', async () => {
    const done = await startTask({ id: 'api-task', kind: 'api', personId: 'person_ada', channelKey: 'api:ada' });
    await finishTask(done.id, 'succeeded');
    await startTask({ id: 'schedule-task', kind: 'schedule', personId: 'person_bob', channelKey: 'discord-channel:ops' });

    const res = await GET(makeRequest('http://localhost:3000/api/dashboard/tasks?status=succeeded&personQuery=ada&channelQuery=api'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(1);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({ id: 'api-task', kind: 'api', status: 'succeeded', personId: 'person_ada' });
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });
});
