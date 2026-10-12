import * as path from 'path';
import * as crypto from 'crypto';
import type { ExecutionLog, LogStatus, LogStore } from './types';
import { dataPath } from '../utils/dataDir';
import { atomicWriteJson, readJsonFileSync, withFileLock } from '../utils/jsonFile';

function storePath(): string {
  return process.env.LOGS_FILE
    ? path.resolve(process.env.LOGS_FILE)
    : dataPath('logs.json');
}

/** Maximum number of log entries retained on disk. */
const MAX_LOGS = 200;

/** Serializes mutations to prevent concurrent read-modify-write races. */
let writeQueue = Promise.resolve();

function loadStore(): LogStore {
  const store = readJsonFileSync<Partial<LogStore> | null>(storePath(), () => ({ logs: [] }));
  return { ...store, logs: Array.isArray(store?.logs) ? store.logs : [] };
}

async function saveStore(store: LogStore): Promise<void> {
  // Keep only the latest MAX_LOGS entries
  if (store.logs.length > MAX_LOGS) {
    store.logs = store.logs.slice(-MAX_LOGS);
  }
  await atomicWriteJson(storePath(), store);
}

/** Start a new in-progress log entry and return its id. */
export async function startLog(entry: Pick<ExecutionLog, 'scheduleId' | 'scheduleName' | 'prompt' | 'reason'>): Promise<string> {
  const id = crypto.randomUUID();
  writeQueue = writeQueue.then(() => withFileLock(storePath(), async () => {
    const store = loadStore();
    store.logs.push({
      id,
      scheduleId: entry.scheduleId,
      scheduleName: entry.scheduleName,
      prompt: entry.prompt,
      reason: entry.reason,
      startedAt: new Date().toISOString(),
    });
    await saveStore(store);
  }));
  await writeQueue;
  return id;
}

/** Finish an existing log entry with the final status and optional result/error. */
export async function finishLog(
  id: string,
  status: LogStatus,
  resultOrError?: string,
): Promise<void> {
  writeQueue = writeQueue.then(() => withFileLock(storePath(), async () => {
    const store = loadStore();
    const entry = store.logs.find((l) => l.id === id);
    if (!entry) return;
    entry.finishedAt = new Date().toISOString();
    entry.status = status;
    if (status === 'success') {
      entry.result = resultOrError;
    } else {
      entry.error = resultOrError;
    }
    await saveStore(store);
  }));
  await writeQueue;
}

/** Return the most recent `limit` log entries, newest first. */
export function listLogs(limit = 50): ExecutionLog[] {
  const store = loadStore();
  return store.logs.slice().reverse().slice(0, limit);
}
