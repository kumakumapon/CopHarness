import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { dataPath } from '../utils/dataDir';
import type { WatcherDefinition, WatcherStoreFile, WatcherType } from './types';

function storePath(): string {
  return process.env.WATCHERS_FILE
    ? path.resolve(process.env.WATCHERS_FILE)
    : dataPath('watchers.json');
}

function emptyStore(): WatcherStoreFile {
  return { watchers: [] };
}

export function loadWatcherStore(): WatcherStoreFile {
  const filePath = storePath();
  if (!fs.existsSync(filePath)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<WatcherStoreFile>;
    return { watchers: Array.isArray(parsed.watchers) ? parsed.watchers : [] };
  } catch {
    return emptyStore();
  }
}

function saveWatcherStore(store: WatcherStoreFile): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

function normalizeOptional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function listWatchers(): WatcherDefinition[] {
  return loadWatcherStore().watchers.map((watcher) => ({
    ...watcher,
    metadata: watcher.metadata ? { ...watcher.metadata } : undefined,
  }));
}

export function getWatcher(id: string): WatcherDefinition | undefined {
  return listWatchers().find((watcher) => watcher.id === id);
}

export function addWatcher(input: {
  name: string;
  type: WatcherType;
  prompt: string;
  enabled?: boolean;
  eventPattern?: string;
  discordChannelId?: string;
  lineUserId?: string;
  metadata?: Record<string, unknown>;
}): WatcherDefinition {
  const store = loadWatcherStore();
  const now = new Date().toISOString();
  const watcher: WatcherDefinition = {
    id: `watcher_${crypto.randomUUID()}`,
    name: input.name.trim(),
    type: input.type.trim() || 'manual',
    prompt: input.prompt.trim(),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    triggerCount: 0,
    eventPattern: normalizeOptional(input.eventPattern),
    discordChannelId: normalizeOptional(input.discordChannelId),
    lineUserId: normalizeOptional(input.lineUserId),
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
  store.watchers.push(watcher);
  saveWatcherStore(store);
  return { ...watcher, metadata: watcher.metadata ? { ...watcher.metadata } : undefined };
}

export function updateWatcher(
  id: string,
  updates: Partial<Pick<WatcherDefinition, 'name' | 'type' | 'prompt' | 'enabled' | 'eventPattern' | 'discordChannelId' | 'lineUserId' | 'metadata'>>,
): WatcherDefinition | undefined {
  const store = loadWatcherStore();
  const watcher = store.watchers.find((entry) => entry.id === id);
  if (!watcher) return undefined;
  if (typeof updates.name === 'string' && updates.name.trim()) watcher.name = updates.name.trim();
  if (typeof updates.type === 'string' && updates.type.trim()) watcher.type = updates.type.trim();
  if (typeof updates.prompt === 'string' && updates.prompt.trim()) watcher.prompt = updates.prompt.trim();
  if (typeof updates.enabled === 'boolean') watcher.enabled = updates.enabled;
  if ('eventPattern' in updates) watcher.eventPattern = normalizeOptional(updates.eventPattern);
  if ('discordChannelId' in updates) watcher.discordChannelId = normalizeOptional(updates.discordChannelId);
  if ('lineUserId' in updates) watcher.lineUserId = normalizeOptional(updates.lineUserId);
  if (updates.metadata && typeof updates.metadata === 'object') watcher.metadata = { ...updates.metadata };
  watcher.updatedAt = new Date().toISOString();
  saveWatcherStore(store);
  return { ...watcher, metadata: watcher.metadata ? { ...watcher.metadata } : undefined };
}

export function removeWatcher(id: string): boolean {
  const store = loadWatcherStore();
  const before = store.watchers.length;
  store.watchers = store.watchers.filter((watcher) => watcher.id !== id);
  if (store.watchers.length === before) return false;
  saveWatcherStore(store);
  return true;
}

export function markWatcherTriggered(id: string, date = new Date()): WatcherDefinition | undefined {
  const store = loadWatcherStore();
  const watcher = store.watchers.find((entry) => entry.id === id);
  if (!watcher) return undefined;
  const now = date.toISOString();
  watcher.lastTriggeredAt = now;
  watcher.updatedAt = now;
  watcher.triggerCount = (watcher.triggerCount ?? 0) + 1;
  saveWatcherStore(store);
  return { ...watcher, metadata: watcher.metadata ? { ...watcher.metadata } : undefined };
}

export function _resetWatchersForTests(): void {
  // Store functions are intentionally stateless; this helper mirrors other stores.
}
