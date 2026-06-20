import * as fs from 'fs';
import * as path from 'path';
import { dispatchWatcherEvent } from '../engine';
import type { WatcherDefinition } from '../types';

const DEFAULT_DEBOUNCE_MS = parseInt(
  process.env.FILE_WATCHER_DEFAULT_DEBOUNCE_MS ?? '500',
  10,
);

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;

export class FileWatcherAdapter {
  private readonly watcher: WatcherDefinition;
  private readonly watchPath: string;
  private readonly debounceMs: number;

  private fsWatcher: fs.FSWatcher | null = null;
  private debounceMap: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private stopped = false;
  private retryCount = 0;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(watcher: WatcherDefinition) {
    this.watcher = watcher;
    const meta = watcher.metadata ?? {};
    this.watchPath = typeof meta['watchPath'] === 'string' ? meta['watchPath'] : '';
    this.debounceMs =
      typeof meta['debounceMs'] === 'number' ? meta['debounceMs'] : DEFAULT_DEBOUNCE_MS;
  }

  start(): void {
    if (!this.watchPath) {
      console.warn(`[FileAdapter:${this.watcher.id}] No watchPath configured, skipping.`);
      return;
    }
    this.stopped = false;
    this.retryCount = 0;
    this.attachWatcher();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    this.detachWatcher();
    // Clear any pending debounce timers
    for (const timer of this.debounceMap.values()) {
      clearTimeout(timer);
    }
    this.debounceMap.clear();
  }

  private detachWatcher(): void {
    if (this.fsWatcher) {
      try {
        this.fsWatcher.close();
      } catch {
        // Ignore close errors
      }
      this.fsWatcher = null;
    }
  }

  private attachWatcher(): void {
    if (this.stopped) return;

    try {
      const options: fs.WatchOptions = { recursive: true };
      this.fsWatcher = fs.watch(this.watchPath, options, (eventType, filename) => {
        const resolvedFilename = filename
          ? path.join(this.watchPath, filename)
          : this.watchPath;
        this.handleChange(eventType as 'change' | 'rename', resolvedFilename, filename ?? null);
      });

      this.fsWatcher.on('error', (err) => {
        console.error(`[FileAdapter:${this.watcher.id}] fs.watch error:`, err);
        this.detachWatcher();
        this.scheduleRestart();
      });

      // Reset retry count on successful attach
      this.retryCount = 0;
      console.log(
        `[FileAdapter:${this.watcher.id}] Watching path: ${this.watchPath}`,
      );
    } catch (err) {
      console.error(`[FileAdapter:${this.watcher.id}] Failed to attach watcher:`, err);
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    if (this.retryCount >= MAX_RETRIES) {
      console.error(
        `[FileAdapter:${this.watcher.id}] Max retries (${MAX_RETRIES}) reached. Giving up.`,
      );
      return;
    }
    const delay = BASE_BACKOFF_MS * Math.pow(2, this.retryCount);
    this.retryCount += 1;
    console.log(
      `[FileAdapter:${this.watcher.id}] Restarting watcher in ${delay}ms (attempt ${this.retryCount}/${MAX_RETRIES})`,
    );
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.attachWatcher();
    }, delay);
  }

  private handleChange(
    eventType: 'change' | 'rename',
    resolvedFilePath: string,
    filename: string | null,
  ): void {
    const existing = this.debounceMap.get(resolvedFilePath);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceMap.delete(resolvedFilePath);
      void this.dispatchChange(eventType, resolvedFilePath, filename);
    }, this.debounceMs);

    this.debounceMap.set(resolvedFilePath, timer);
  }

  private async dispatchChange(
    eventType: 'change' | 'rename',
    resolvedFilePath: string,
    filename: string | null,
  ): Promise<void> {
    try {
      await dispatchWatcherEvent({
        source: 'file',
        type: eventType,
        subject: resolvedFilePath,
        payload: {
          watchPath: this.watchPath,
          filename: filename ?? path.basename(resolvedFilePath),
        },
      });
    } catch (err) {
      console.error(
        `[FileAdapter:${this.watcher.id}] Dispatch error for ${resolvedFilePath}:`,
        err,
      );
    }
  }
}
