import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { addSchedule, listSchedules } from '../../lib/scheduler/store';
import { addWatcher, listWatchers } from '../../lib/watchers/store';
import { finishLog, listLogs, startLog } from '../../lib/logs/store';

describe('JSON stores survive a corrupt file without silently destroying it (#140)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-corrupt-'));
    process.env.DATA_DIR = dir;
    _resetDataDirCache();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const quarantined = (name: string) => fs.readdirSync(dir).filter((f) => f.startsWith(`${name}.corrupt-`));
  const leftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'));

  it('scheduler: a truncated schedules.json is preserved aside and the next add starts a fresh valid file', () => {
    const truncated = '{\n  "schedules": [\n    { "id": "keep-me", "name": "important"';
    fs.writeFileSync(path.join(dir, 'schedules.json'), truncated);

    expect(listSchedules()).toEqual([]); // reading does not crash
    expect(quarantined('schedules.json')).toHaveLength(1);

    addSchedule({ name: 'new', cron: '* * * * *', prompt: 'p' });
    expect(listSchedules().map((s) => s.name)).toEqual(['new']);
    const moved = quarantined('schedules.json');
    expect(moved).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, moved[0]), 'utf-8')).toBe(truncated);
    expect(() => JSON.parse(fs.readFileSync(path.join(dir, 'schedules.json'), 'utf-8'))).not.toThrow();
    expect(leftovers()).toEqual([]);
  });

  it('scheduler: valid JSON of the wrong shape is treated as empty, not as a crash', () => {
    fs.writeFileSync(path.join(dir, 'schedules.json'), '{"schedules": "nope"}');
    expect(listSchedules()).toEqual([]);
    fs.writeFileSync(path.join(dir, 'schedules.json'), 'null');
    expect(listSchedules()).toEqual([]);
  });

  it('watchers: a corrupt watchers.json is quarantined before the next write', () => {
    fs.writeFileSync(path.join(dir, 'watchers.json'), '{"watchers": [');
    addWatcher({ name: 'w', type: 'manual', prompt: 'p' });
    expect(listWatchers().map((w) => w.name)).toEqual(['w']);
    expect(quarantined('watchers.json')).toHaveLength(1);
    expect(leftovers()).toEqual([]);
  });

  it('logs: a corrupt logs.json is quarantined and logging keeps working', async () => {
    fs.writeFileSync(path.join(dir, 'logs.json'), '{"logs": [{"id"');
    const id = await startLog({ scheduleId: 's', scheduleName: 'n', prompt: 'p', reason: 'scheduled' });
    await finishLog(id, 'success', 'done');
    expect(listLogs().map((l) => [l.id, l.status])).toEqual([[id, 'success']]);
    expect(quarantined('logs.json')).toHaveLength(1);
    expect(leftovers()).toEqual([]);
  });
});
