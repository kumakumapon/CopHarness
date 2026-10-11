import * as path from 'path';
import * as crypto from 'crypto';
import type { ScheduledPrompt, ScheduleStore } from './types';
import { dataPath } from '../utils/dataDir';
import { atomicWriteJsonSync, readJsonFileSync, withFileLockSync } from '../utils/jsonFile';

function storePath(): string {
  return process.env.SCHEDULES_FILE
    ? path.resolve(process.env.SCHEDULES_FILE)
    : dataPath('schedules.json');
}

export function loadStore(): ScheduleStore {
  const store = readJsonFileSync<Partial<ScheduleStore> | null>(storePath(), () => ({ schedules: [] }));
  return { ...store, schedules: Array.isArray(store?.schedules) ? store.schedules : [] };
}

function saveStore(store: ScheduleStore): void {
  atomicWriteJsonSync(storePath(), store);
}

/**
 * Read-modify-write under a cross-process lock so concurrent writers (server,
 * CLI, Discord bot, scheduler tick) cannot overwrite each other's updates.
 * `fn` returns the result plus whether the store changed (and so must be saved).
 */
function mutate<T>(fn: (store: ScheduleStore) => { result: T; changed: boolean }): T {
  return withFileLockSync(storePath(), () => {
    const store = loadStore();
    const { result, changed } = fn(store);
    if (changed) saveStore(store);
    return result;
  });
}

export function listSchedules(): ScheduledPrompt[] {
  return loadStore().schedules;
}

export function addSchedule(
  input: Pick<ScheduledPrompt, 'name' | 'cron' | 'prompt' | 'discordChannelId' | 'lineUserId' | 'toolsets'>,
): ScheduledPrompt {
  return mutate((store) => {
    const entry: ScheduledPrompt = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      enabled: true,
      ...input,
    };
    store.schedules.push(entry);
    return { result: entry, changed: true };
  });
}

export function removeSchedule(id: string): boolean {
  return mutate((store) => {
    const before = store.schedules.length;
    store.schedules = store.schedules.filter((s) => s.id !== id);
    const removed = store.schedules.length !== before;
    return { result: removed, changed: removed };
  });
}

/** Apply `update` to the schedule with `id`; returns false when it does not exist. */
function patch(id: string, update: (s: ScheduledPrompt) => void): boolean {
  return mutate((store) => {
    const s = store.schedules.find((x) => x.id === id);
    if (!s) return { result: false, changed: false };
    update(s);
    return { result: true, changed: true };
  });
}

export function setEnabled(id: string, enabled: boolean): boolean {
  return patch(id, (s) => { s.enabled = enabled; });
}

export function updateLastRun(id: string, date: Date): void {
  patch(id, (s) => { s.lastRun = date.toISOString(); });
}

export function setRunNow(id: string, value: boolean): boolean {
  return patch(id, (s) => { s.runNow = value || undefined; });
}

export function setStopRequested(id: string, value: boolean): boolean {
  return patch(id, (s) => { s.stopRequested = value || undefined; });
}

export function updateSchedule(
  id: string,
  updates: Partial<Pick<ScheduledPrompt, 'name' | 'cron' | 'prompt' | 'discordChannelId' | 'lineUserId' | 'toolsets'>>,
): boolean {
  return patch(id, (s) => { Object.assign(s, updates); });
}
