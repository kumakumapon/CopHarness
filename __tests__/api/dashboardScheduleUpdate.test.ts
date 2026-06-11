import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { addSchedule } from '../../lib/scheduler/store';
import { PATCH } from '../../app/api/dashboard/schedules/[id]/route';

describe('dashboard schedule PATCH API - toolsets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-schedule-update-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.COPHARNESS_API_KEY;
    _resetDataDirCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function patchRequest(id: string, body: unknown) {
    return new NextRequest(`http://localhost:3000/api/dashboard/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  function createSchedule() {
    return addSchedule({
      name: 'Test Schedule',
      cron: '0 * * * *',
      prompt: 'Do something',
      discordChannelId: undefined,
      lineUserId: undefined,
      toolsets: undefined,
    });
  }

  it('(a) 有効な toolsets 配列で PATCH すると 200 かつ toolsets が更新される', async () => {
    const schedule = createSchedule();
    const res = await PATCH(
      patchRequest(schedule.id, { toolsets: ['research', 'coding'] }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);

    // ストアを再読み込みして toolsets が保存されていることを確認
    const { listSchedules } = await import('../../lib/scheduler/store');
    const updated = listSchedules().find((s) => s.id === schedule.id);
    expect(updated?.toolsets).toEqual(['research', 'coding']);
  });

  it('(b) toolsets が非配列の場合は 400 を返す', async () => {
    const schedule = createSchedule();
    const res = await PATCH(
      patchRequest(schedule.id, { toolsets: 'research' }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('toolsets must be an array of strings');
  });

  it('(b) toolsets が string 以外の要素を含む場合は 400 を返す', async () => {
    const schedule = createSchedule();
    const res = await PATCH(
      patchRequest(schedule.id, { toolsets: ['research', 42] }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('toolsets must be an array of strings');
  });

  it('(c) 空配列 [] で toolsets がクリアされる', async () => {
    const schedule = addSchedule({
      name: 'Schedule with toolsets',
      cron: '0 * * * *',
      prompt: 'Do something',
      discordChannelId: undefined,
      lineUserId: undefined,
      toolsets: ['research'],
    });

    const res = await PATCH(
      patchRequest(schedule.id, { toolsets: [] }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);

    const { listSchedules } = await import('../../lib/scheduler/store');
    const updated = listSchedules().find((s) => s.id === schedule.id);
    expect(updated?.toolsets).toEqual([]);
  });

  it('存在しない ID で PATCH すると 404 を返す', async () => {
    const res = await PATCH(
      patchRequest('nonexistent-id', { toolsets: ['research'] }),
      { params: Promise.resolve({ id: 'nonexistent-id' }) },
    );
    expect(res.status).toBe(404);
  });

  it('API キーが設定されている場合、未認証リクエストは 401 を返す', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const schedule = createSchedule();
    const res = await PATCH(
      patchRequest(schedule.id, { toolsets: ['research'] }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    expect(res.status).toBe(401);
  });
});
