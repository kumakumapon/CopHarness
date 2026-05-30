import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ScheduledPrompt, ScheduleStore } from './types';
import { dataPath } from '../utils/dataDir';

function storePath(): string {
  return process.env.SCHEDULES_FILE
    ? path.resolve(process.env.SCHEDULES_FILE)
    : dataPath('schedules.json');
}

export function loadStore(): ScheduleStore {
  const p = storePath();
  if (!fs.existsSync(p)) return { schedules: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ScheduleStore;
  } catch {
    return { schedules: [] };
  }
}

function saveStore(store: ScheduleStore): void {
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

export function listSchedules(): ScheduledPrompt[] {
  return loadStore().schedules;
}

export function addSchedule(
  input: Pick<ScheduledPrompt, 'name' | 'cron' | 'prompt' | 'discordChannelId'>,
): ScheduledPrompt {
  const store = loadStore();
  const entry: ScheduledPrompt = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    enabled: true,
    ...input,
  };
  store.schedules.push(entry);
  saveStore(store);
  return entry;
}

export function removeSchedule(id: string): boolean {
  const store = loadStore();
  const before = store.schedules.length;
  store.schedules = store.schedules.filter((s) => s.id !== id);
  if (store.schedules.length === before) return false;
  saveStore(store);
  return true;
}

export function setEnabled(id: string, enabled: boolean): boolean {
  const store = loadStore();
  const s = store.schedules.find((x) => x.id === id);
  if (!s) return false;
  s.enabled = enabled;
  saveStore(store);
  return true;
}

export function updateLastRun(id: string, date: Date): void {
  const store = loadStore();
  const s = store.schedules.find((x) => x.id === id);
  if (s) {
    s.lastRun = date.toISOString();
    saveStore(store);
  }
}

export function setRunNow(id: string, value: boolean): boolean {
  const store = loadStore();
  const s = store.schedules.find((x) => x.id === id);
  if (!s) return false;
  s.runNow = value || undefined;
  saveStore(store);
  return true;
}

export function setStopRequested(id: string, value: boolean): boolean {
  const store = loadStore();
  const s = store.schedules.find((x) => x.id === id);
  if (!s) return false;
  s.stopRequested = value || undefined;
  saveStore(store);
  return true;
}

export function updateSchedule(
  id: string,
  updates: Partial<Pick<ScheduledPrompt, 'name' | 'cron' | 'prompt' | 'discordChannelId'>>,
): boolean {
  const store = loadStore();
  const s = store.schedules.find((x) => x.id === id);
  if (!s) return false;
  Object.assign(s, updates);
  saveStore(store);
  return true;
}
