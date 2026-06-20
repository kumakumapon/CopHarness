import { listWatchers } from './store';
import { RssWatcherAdapter } from './adapters/rssAdapter';
import { FileWatcherAdapter } from './adapters/fileAdapter';
import type { WatcherDefinition } from './types';

type AnyAdapter = RssWatcherAdapter | FileWatcherAdapter;

const activeAdapters = new Map<string, AnyAdapter>();
let reloadIntervalHandle: ReturnType<typeof setInterval> | null = null;
const RELOAD_INTERVAL_MS = 60_000;

function createAdapter(watcher: WatcherDefinition): AnyAdapter | null {
  switch (watcher.type) {
    case 'rss':
      return new RssWatcherAdapter(watcher);
    case 'file':
      return new FileWatcherAdapter(watcher);
    default:
      return null;
  }
}

export function startWatcherAdapters(): void {
  const watchers = listWatchers();
  for (const watcher of watchers) {
    if (!watcher.enabled) continue;
    if (activeAdapters.has(watcher.id)) continue;

    const adapter = createAdapter(watcher);
    if (!adapter) continue;

    try {
      adapter.start();
      activeAdapters.set(watcher.id, adapter);
      console.log(`[AdapterDaemon] Started adapter for watcher ${watcher.id} (type: ${watcher.type})`);
    } catch (err) {
      console.error(`[AdapterDaemon] Failed to start adapter for watcher ${watcher.id}:`, err);
    }
  }

  // Start periodic reload if not already running
  if (reloadIntervalHandle === null) {
    reloadIntervalHandle = setInterval(() => {
      reloadWatcherAdapters();
    }, RELOAD_INTERVAL_MS);
    // Allow the process to exit even with this interval running
    if (typeof reloadIntervalHandle === 'object' && reloadIntervalHandle !== null && 'unref' in reloadIntervalHandle) {
      (reloadIntervalHandle as NodeJS.Timeout).unref();
    }
  }
}

export function stopWatcherAdapters(): void {
  if (reloadIntervalHandle !== null) {
    clearInterval(reloadIntervalHandle);
    reloadIntervalHandle = null;
  }

  for (const [id, adapter] of activeAdapters.entries()) {
    try {
      adapter.stop();
      console.log(`[AdapterDaemon] Stopped adapter for watcher ${id}`);
    } catch (err) {
      console.error(`[AdapterDaemon] Error stopping adapter for watcher ${id}:`, err);
    }
  }
  activeAdapters.clear();
}

export function reloadWatcherAdapters(): void {
  let watchers: WatcherDefinition[];
  try {
    watchers = listWatchers();
  } catch (err) {
    console.error('[AdapterDaemon] Failed to list watchers during reload:', err);
    return;
  }

  const currentWatcherIds = new Set(
    watchers.filter((w) => w.enabled).map((w) => w.id),
  );

  // Stop adapters for watchers that are gone or disabled
  for (const [id, adapter] of activeAdapters.entries()) {
    if (!currentWatcherIds.has(id)) {
      try {
        adapter.stop();
        console.log(`[AdapterDaemon] Stopped removed/disabled adapter for watcher ${id}`);
      } catch (err) {
        console.error(`[AdapterDaemon] Error stopping adapter for watcher ${id}:`, err);
      }
      activeAdapters.delete(id);
    }
  }

  // Start adapters for new watchers
  for (const watcher of watchers) {
    if (!watcher.enabled) continue;
    if (activeAdapters.has(watcher.id)) continue;

    const adapter = createAdapter(watcher);
    if (!adapter) continue;

    try {
      adapter.start();
      activeAdapters.set(watcher.id, adapter);
      console.log(`[AdapterDaemon] Started new adapter for watcher ${watcher.id} (type: ${watcher.type})`);
    } catch (err) {
      console.error(`[AdapterDaemon] Failed to start adapter for watcher ${watcher.id}:`, err);
    }
  }
}
