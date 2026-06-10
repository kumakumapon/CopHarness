/**
 * Lightweight task ledger for conversation/API/scheduler/sub-agent work units.
 *
 * The ledger gives each user-visible run a stable `taskId` so skill execution
 * logs, approvals, and dashboard records can be correlated without relying on
 * callers to provide their own identifiers.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { dataPath } from '../utils/dataDir';
import { indexTaskRecord } from '../search/index';

export type TaskKind = 'conversation' | 'api' | 'wizard' | 'schedule' | 'agent' | string;
export type TaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  personId?: string;
  channelKey?: string;
  conversationKey?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
  errorPreview?: string;
  metadata?: Record<string, unknown>;
}

interface TaskLedgerFile {
  tasks: Record<string, TaskRecord>;
  order: string[];
}

const MAX_TASKS = 1000;
const ERROR_PREVIEW_LENGTH = 240;

let _ledger: TaskLedgerFile | null = null;
let _writeQueue: Promise<void> = Promise.resolve();

function ledgerFilePath(): string {
  const explicit = process.env.TASK_LEDGER_FILE;
  if (explicit) return path.resolve(explicit);
  return dataPath('task_ledger.json');
}

function emptyLedger(): TaskLedgerFile {
  return { tasks: {}, order: [] };
}

function getLedger(): TaskLedgerFile {
  if (_ledger) return _ledger;
  const filePath = ledgerFilePath();
  if (!fs.existsSync(filePath)) {
    _ledger = emptyLedger();
    return _ledger;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<TaskLedgerFile>;
    const tasks = parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {};
    const order = Array.isArray(parsed.order) ? parsed.order.filter((id) => typeof id === 'string' && tasks[id]) : Object.keys(tasks);
    _ledger = { tasks, order };
  } catch {
    _ledger = emptyLedger();
  }
  return _ledger;
}

function trimLedger(ledger: TaskLedgerFile): void {
  while (ledger.order.length > MAX_TASKS) {
    const id = ledger.order.shift();
    if (id) delete ledger.tasks[id];
  }
}

function scheduleWrite(): Promise<void> {
  _writeQueue = _writeQueue.then(async () => {
    const filePath = ledgerFilePath();
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(getLedger(), null, 2) + '\n', 'utf-8');
  });
  return _writeQueue;
}

function previewError(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  const text = error instanceof Error ? error.message : String(error);
  return text.length > ERROR_PREVIEW_LENGTH ? `${text.slice(0, ERROR_PREVIEW_LENGTH)}…` : text;
}

export async function startTask(input: {
  id?: string;
  kind: TaskKind;
  personId?: string;
  channelKey?: string;
  conversationKey?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}): Promise<TaskRecord> {
  const ledger = getLedger();
  const now = new Date().toISOString();
  const id = input.id?.trim() || `task_${randomUUID()}`;
  const existing = ledger.tasks[id];

  const task: TaskRecord = {
    ...(existing ?? { id, createdAt: now, startedAt: now }),
    id,
    kind: input.kind,
    status: 'running',
    personId: input.personId,
    channelKey: input.channelKey,
    conversationKey: input.conversationKey,
    title: input.title,
    metadata: input.metadata,
    updatedAt: now,
    startedAt: now,
    finishedAt: undefined,
    errorPreview: undefined,
  };

  ledger.tasks[id] = task;
  if (!ledger.order.includes(id)) ledger.order.push(id);
  trimLedger(ledger);
  await scheduleWrite();
  const result = { ...task, metadata: task.metadata ? { ...task.metadata } : undefined };
  // Index failure must never affect startTask behaviour
  indexTaskRecord(result);
  return result;
}

export async function finishTask(
  id: string,
  status: Exclude<TaskStatus, 'running'>,
  error?: unknown,
): Promise<TaskRecord | undefined> {
  const ledger = getLedger();
  const task = ledger.tasks[id];
  if (!task) return undefined;
  const now = new Date().toISOString();
  task.status = status;
  task.updatedAt = now;
  task.finishedAt = now;
  task.errorPreview = previewError(error);
  await scheduleWrite();
  const finished = { ...task, metadata: task.metadata ? { ...task.metadata } : undefined };
  // Index failure must never affect finishTask behaviour
  indexTaskRecord(finished);
  return finished;
}

export function getTask(id: string): TaskRecord | undefined {
  const task = getLedger().tasks[id];
  return task ? { ...task, metadata: task.metadata ? { ...task.metadata } : undefined } : undefined;
}


export interface TaskQueryOptions {
  limit?: number;
  status?: TaskStatus;
  kindQuery?: string;
  personQuery?: string;
  channelQuery?: string;
  from?: Date;
  to?: Date;
}

function normalizeQuery(value?: string): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

function includesQuery(value: string | undefined, query: string | undefined): boolean {
  if (!query) return true;
  return value?.toLowerCase().includes(query) ?? false;
}

function taskUpdatedAtMs(task: TaskRecord): number {
  const parsed = new Date(task.updatedAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function cloneTask(task: TaskRecord): TaskRecord {
  return { ...task, metadata: task.metadata ? { ...task.metadata } : undefined };
}

export function queryTasks(options: TaskQueryOptions = {}): { tasks: TaskRecord[]; total: number } {
  const ledger = getLedger();
  const limit = Math.max(1, Math.min(options.limit ?? 50, MAX_TASKS));
  const kindQuery = normalizeQuery(options.kindQuery);
  const personQuery = normalizeQuery(options.personQuery);
  const channelQuery = normalizeQuery(options.channelQuery);
  const fromMs = options.from?.getTime();
  const toMs = options.to?.getTime();

  const filtered = ledger.order
    .slice()
    .reverse()
    .map((id) => ledger.tasks[id])
    .filter(Boolean)
    .filter((task) => {
      if (options.status && task.status !== options.status) return false;
      if (!includesQuery(task.kind, kindQuery)) return false;
      if (!includesQuery(task.personId, personQuery)) return false;
      if (!includesQuery(task.channelKey, channelQuery)) return false;
      const updatedAt = taskUpdatedAtMs(task);
      if (fromMs !== undefined && Number.isFinite(fromMs) && updatedAt < fromMs) return false;
      if (toMs !== undefined && Number.isFinite(toMs) && updatedAt > toMs) return false;
      return true;
    });

  return {
    tasks: filtered.slice(0, limit).map(cloneTask),
    total: filtered.length,
  };
}

export function listTasks(limit = 50): TaskRecord[] {
  return queryTasks({ limit }).tasks;
}

/** Test helper: clear in-memory state so env-controlled file paths are re-read. */
export function _resetTaskLedgerForTests(): void {
  _ledger = null;
  _writeQueue = Promise.resolve();
}
