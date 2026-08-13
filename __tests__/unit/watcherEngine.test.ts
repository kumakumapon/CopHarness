import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { dispatchWatcherEvent, findMatchingWatchers, triggerWatcher } from '../../lib/watchers/engine';
import type { WatcherPromptRunner } from '../../lib/watchers/engine';
import { addWatcher, listWatchers } from '../../lib/watchers/store';

describe('watcher engine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-watcher-engine-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs matching watchers with event context and records trigger counts', async () => {
    const watcher = addWatcher({
      name: 'Webhook watcher',
      type: 'webhook',
      prompt: 'Handle this event',
      eventPattern: 'deploy',
    });
    const runner = jest.fn<ReturnType<WatcherPromptRunner>, Parameters<WatcherPromptRunner>>(async () => 'done');

    const result = await triggerWatcher(
      watcher.id,
      { source: 'webhook', type: 'push', subject: 'deploy production' },
      { runner },
    );

    expect(result).toMatchObject({ ok: true, result: 'done' });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toContain('Handle this event');
    expect(runner.mock.calls[0][0]).toContain('deploy production');
    expect(runner.mock.calls[0][2]).toMatchObject({
      watcher: { id: watcher.id, name: 'Webhook watcher', type: 'webhook' },
      reason: 'watcher:webhook',
    });
    expect(listWatchers()[0]).toMatchObject({ triggerCount: 1 });
  });

  it('skips disabled and non-matching watchers', async () => {
    const disabled = addWatcher({
      name: 'Disabled watcher',
      type: 'manual',
      prompt: 'Do work',
      enabled: false,
    });
    const filtered = addWatcher({
      name: 'Filtered watcher',
      type: 'webhook',
      prompt: 'Do work',
      eventPattern: 'invoice',
    });
    const runner = jest.fn<ReturnType<WatcherPromptRunner>, Parameters<WatcherPromptRunner>>(async () => 'done');

    await expect(triggerWatcher(disabled.id, { source: 'dashboard' }, { runner }))
      .resolves.toEqual({ ok: false, reason: 'disabled' });
    await expect(triggerWatcher(filtered.id, { source: 'webhook', subject: 'deploy' }, { runner }))
      .resolves.toEqual({ ok: false, reason: 'event_not_matched' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('finds enabled watchers by event source and pattern', () => {
    addWatcher({
      name: 'Webhook deploy watcher',
      type: 'webhook',
      prompt: 'Deploy check',
      eventPattern: 'deploy',
    });
    addWatcher({
      name: 'GitHub issue watcher',
      type: 'github',
      prompt: 'Issue check',
      eventPattern: 'opened',
    });
    addWatcher({
      name: 'Disabled watcher',
      type: 'webhook',
      prompt: 'Disabled check',
      enabled: false,
    });

    const matches = findMatchingWatchers({
      source: 'webhook',
      subject: 'deploy production',
    });

    expect(matches.map((watcher) => watcher.name)).toEqual(['Webhook deploy watcher']);
  });

  it('dispatches one event to matching watchers in parallel', async () => {
    const first = addWatcher({
      name: 'Deploy summary',
      type: 'webhook',
      prompt: 'Summarize deploy',
      eventPattern: 'deploy',
    });
    const second = addWatcher({
      name: 'Deploy risk check',
      type: 'webhook',
      prompt: 'Check deploy risk',
      eventPattern: 'deploy',
    });
    addWatcher({
      name: 'Invoice watcher',
      type: 'webhook',
      prompt: 'Check invoices',
      eventPattern: 'invoice',
    });
    const runner = jest.fn<ReturnType<WatcherPromptRunner>, Parameters<WatcherPromptRunner>>(
      async (_prompt, _signal, context) => `done:${context.watcher.id}`,
    );

    const result = await dispatchWatcherEvent(
      { source: 'webhook', type: 'push', subject: 'deploy production' },
      { runner },
    );

    expect(result.matched).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results).toEqual([
      expect.objectContaining({ ok: true, watcher: expect.objectContaining({ id: first.id }) }),
      expect.objectContaining({ ok: true, watcher: expect.objectContaining({ id: second.id }) }),
    ]);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(listWatchers().filter((watcher) => watcher.triggerCount === 1)).toHaveLength(2);
  });

  it('matches GitHub watchers by normalized metadata filters', () => {
    addWatcher({
      name: 'Bug issue watcher',
      type: 'github',
      prompt: 'Handle bugs',
      metadata: { eventTypes: ['issues.opened'], labels: ['bug'], authors: ['octocat'] },
    });
    addWatcher({
      name: 'Docs issue watcher',
      type: 'github',
      prompt: 'Handle docs',
      metadata: { labels: ['documentation'] },
    });

    const matches = findMatchingWatchers({
      source: 'github',
      type: 'issues.opened',
      subject: 'kumakumapon/CopHarness #89 Bug report',
      payload: { labels: ['bug'], author: 'octocat', repository: 'kumakumapon/CopHarness' },
    });

    expect(matches.map((watcher) => watcher.name)).toEqual(['Bug issue watcher']);
  });
});
