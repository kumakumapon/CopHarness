import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ExecutionLog, LogStatus, LogStore } from './types';
import { dataPath } from '../utils/dataDir';

function storePath(): string {
  return process.env.LOGS_FILE
    ? path.resolve(process.env.LOGS_FILE)
    : dataPath('logs.json');
}

/** Maximum number of log entries retained on disk. */
const MAX_LOGS = 200;

function loadStore(): LogStore {
  const p = storePath();
  if (!fs.existsSync(p)) return { logs: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as LogStore;
  } catch {
    return { logs: [] };
  }
}

async function saveStore(store: LogStore): Promise<void> {
  // Keep only the latest MAX_LOGS entries
  if (store.logs.length > MAX_LOGS) {
    store.logs = store.logs.slice(-MAX_LOGS);
  }
  await fsp.writeFile(storePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

/** Start a new in-progress log entry and return its id. */
export async function startLog(entry: Pick<ExecutionLog, 'scheduleId' | 'scheduleName' | 'prompt' | 'reason'>): Promise<string> {
  const store = loadStore();
  const id = crypto.randomUUID();
  store.logs.push({
    id,
    scheduleId: entry.scheduleId,
    scheduleName: entry.scheduleName,
    prompt: entry.prompt,
    reason: entry.reason,
    startedAt: new Date().toISOString(),
  });
  await saveStore(store);
  return id;
}

/** Finish an existing log entry with the final status and optional result/error. */
export async function finishLog(
  id: string,
  status: LogStatus,
  resultOrError?: string,
): Promise<void> {
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
}

/** Return the most recent `limit` log entries, newest first. */
export function listLogs(limit = 50): ExecutionLog[] {
  const store = loadStore();
  return store.logs.slice().reverse().slice(0, limit);
}
