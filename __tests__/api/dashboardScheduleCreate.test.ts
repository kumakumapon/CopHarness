import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { POST } from '../../app/api/dashboard/schedules/route';
import { listSchedules } from '../../lib/scheduler/store';

describe('dashboard schedules POST API - cron validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-schedule-create-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const post = (cron: string) =>
    POST(new NextRequest('http://localhost:3000/api/dashboard/schedules', {
      method: 'POST',
      body: JSON.stringify({ name: 'n', cron, prompt: 'p' }),
    }));

  it('rejects a cron that can never fire and stores nothing', async () => {
    const res = await post('0 25 * * *');
    expect(res.status).toBe(400);
    expect(listSchedules()).toHaveLength(0);
  });

  it('accepts a valid cron and returns nextRun', async () => {
    const res = await post('*/15 * * * *');
    expect(res.status).toBe(201);
    const body = await res.json() as { schedule: { nextRun: string | null } };
    expect(body.schedule.nextRun).not.toBeNull();
    expect(listSchedules()).toHaveLength(1);
  });
});
