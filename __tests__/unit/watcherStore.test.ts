import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  addWatcher,
  listWatchers,
  markWatcherTriggered,
  removeWatcher,
  updateWatcher,
} from '../../lib/watchers/store';

describe('watcher store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-watchers-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates, updates, triggers, and removes watchers', () => {
    const watcher = addWatcher({
      name: 'GitHub issue watcher',
      type: 'github',
      prompt: 'Summarize the issue',
      eventPattern: 'opened',
    });

    expect(watcher.id).toMatch(/^watcher_/);
    expect(listWatchers()).toHaveLength(1);

    const updated = updateWatcher(watcher.id, { enabled: false, eventPattern: 'assigned' });
    expect(updated).toMatchObject({ enabled: false, eventPattern: 'assigned' });

    const triggered = markWatcherTriggered(watcher.id, new Date('2026-06-10T00:00:00.000Z'));
    expect(triggered).toMatchObject({
      triggerCount: 1,
      lastTriggeredAt: '2026-06-10T00:00:00.000Z',
    });

    expect(removeWatcher(watcher.id)).toBe(true);
    expect(listWatchers()).toEqual([]);
  });
});
