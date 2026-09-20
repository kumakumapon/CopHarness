import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAdapterWithFallback } from '../../lib/adapterFactory';
import { startScheduler } from '../../lib/scheduler/engine';
import { addSchedule, setRunNow } from '../../lib/scheduler/store';
import { listTasks, _resetTaskLedgerForTests } from '../../lib/tasks/ledger';
import { getTaskDetail } from '../../lib/tasks/detail';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { listLogs } from '../../lib/logs/store';

jest.mock('../../lib/adapterFactory', () => ({
  createAdapterWithFallback: jest.fn(), resolveProvider: () => 'mock', resolveModel: () => 'fixture', resolveApiKey: () => undefined,
}));

it('runs cron and manual notifications through the same scheduler and traces provider failures', async () => {
  const env = { ...process.env };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-tutorial-'));
  process.env.DATA_DIR = dir;
  _resetDataDirCache(); _resetTaskLedgerForTests();
  const complete = jest.fn().mockResolvedValue({ content: 'Daily plan' });
  jest.mocked(createAdapterWithFallback).mockReturnValue({ provider: 'mock', model: 'fixture', complete });
  let tick: () => void = () => {};
  jest.spyOn(global, 'setInterval').mockImplementation(((callback: () => void) => { tick = callback; return {} as NodeJS.Timeout; }) as typeof setInterval);
  jest.spyOn(process, 'on').mockReturnValue(process);
  let delivered: (payload: { status: string; message: string }) => void = () => {};
  const nextDelivery = () => new Promise<{ status: string; message: string }>(resolve => { delivered = resolve; });
  try {
    const schedule = addSchedule({ name: 'Daily plan', cron: '* * * * *', prompt: 'Plan today', discordChannelId: 'test-channel' });
    let notification = nextDelivery();
    startScheduler(async (channel, name, payload) => {
      expect(channel).toBe('test-channel'); expect(name).toBe('Daily plan'); delivered(payload);
    });
    expect(await notification).toEqual({ status: 'success', message: 'Daily plan' });
    // Let the previous promise chain release its active-run guard.
    await new Promise(resolve => setImmediate(resolve));
    setRunNow(schedule.id, true); notification = nextDelivery(); tick();
    expect(await notification).toEqual({ status: 'success', message: 'Daily plan' });
    await new Promise(resolve => setImmediate(resolve));
    complete.mockRejectedValueOnce(new Error('provider offline'));
    setRunNow(schedule.id, true); notification = nextDelivery(); tick();
    expect(await notification).toEqual({ status: 'failed', message: 'provider offline' });
    await new Promise(resolve => setImmediate(resolve));
    const tasks = listTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.filter(t => t.status === 'succeeded')).toHaveLength(2);
    expect(tasks.filter(t => t.status === 'failed')).toHaveLength(1);
    expect(tasks.map(t => t.metadata?.reason)).toContain('cron');
    expect(tasks.map(t => t.metadata?.reason)).toContain('manual fire');
    const detail = getTaskDetail(tasks.find(t => t.status === 'succeeded')!.id)!;
    expect(detail.input).toBe('Plan today'); expect(detail.output).toBe('Daily plan');
    // finishLog persists asynchronously after notification dispatch.
    for (let i = 0; i < 100 && (listLogs().length !== 3 || listLogs().some(l => !l.status)); i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(listLogs().map(l => l.status).sort()).toEqual(['failed', 'success', 'success']);
  } finally {
    jest.restoreAllMocks(); process.env = env;
    _resetTaskLedgerForTests(); _resetDataDirCache(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
