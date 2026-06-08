/**
 * Persistent skill execution log and aggregate metrics.
 *
 * The log is intentionally small and append-only-ish: it retains the latest
 * executions on disk so the dashboard can show recent activity and derive
 * per-skill success rate / latency without requiring an external telemetry
 * backend.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import { dataPath } from '../utils/dataDir';

export type SkillExecutionStatus = 'success' | 'error' | 'exception';

export interface SkillExecutionRecord {
  id: string;
  skillName: string;
  personId?: string;
  channelKey?: string;
  taskId?: string;
  approvalId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: SkillExecutionStatus;
  argsPreview: string;
  resultPreview?: string;
  errorPreview?: string;
}

export interface SkillExecutionSummary {
  skillName: string;
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  exceptionRuns: number;
  successRate: number | null;
  averageDurationMs: number | null;
  lastRunAt?: string;
  lastStatus?: SkillExecutionStatus;
  lastErrorPreview?: string;
}

const MAX_RECORDS = 500;
const PREVIEW_LENGTH = 240;

let buffer: SkillExecutionRecord[] = [];
let loaded = false;

function storePath(): string {
  return dataPath('skill_executions.json');
}

function safePreview(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return '';
    return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
  } catch {
    return '[unserializable]';
  }
}

function loadFromFile(): SkillExecutionRecord[] {
  const p = storePath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as SkillExecutionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ensureLoaded(): void {
  if (loaded) return;
  buffer = loadFromFile().slice(-MAX_RECORDS);
  loaded = true;
}

async function persist(): Promise<void> {
  const toWrite = buffer.slice(-MAX_RECORDS);
  try {
    await fsp.writeFile(storePath(), JSON.stringify(toWrite, null, 2) + '\n', 'utf-8');
  } catch {
    // Skill metrics are diagnostic only; tool execution should not fail because
    // a local metrics write failed.
  }
}

export async function recordSkillExecution(input: {
  skillName: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  status: SkillExecutionStatus;
  args: Record<string, unknown>;
  resultContent?: string;
  error?: unknown;
  personId?: string;
  channelKey?: string;
  taskId?: string;
  approvalId?: string;
}): Promise<void> {
  ensureLoaded();
  const record: SkillExecutionRecord = {
    id: crypto.randomUUID(),
    skillName: input.skillName,
    personId: input.personId,
    channelKey: input.channelKey,
    taskId: input.taskId,
    approvalId: input.approvalId,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: input.durationMs,
    status: input.status,
    argsPreview: safePreview(input.args),
    resultPreview: input.resultContent === undefined ? undefined : safePreview(input.resultContent),
    errorPreview: input.error === undefined ? undefined : safePreview(input.error instanceof Error ? input.error.message : input.error),
  };
  buffer.push(record);
  if (buffer.length > MAX_RECORDS) buffer = buffer.slice(-MAX_RECORDS);
  await persist();
}

export function listSkillExecutions(limit = 50): SkillExecutionRecord[] {
  ensureLoaded();
  return buffer.slice().reverse().slice(0, Math.min(limit, MAX_RECORDS));
}

export function listSkillExecutionSummaries(): SkillExecutionSummary[] {
  ensureLoaded();
  const bySkill = new Map<string, SkillExecutionRecord[]>();
  for (const record of buffer) {
    const records = bySkill.get(record.skillName) ?? [];
    records.push(record);
    bySkill.set(record.skillName, records);
  }

  return Array.from(bySkill.entries())
    .map(([skillName, records]) => {
      const totalRuns = records.length;
      const successRuns = records.filter((r) => r.status === 'success').length;
      const errorRuns = records.filter((r) => r.status === 'error').length;
      const exceptionRuns = records.filter((r) => r.status === 'exception').length;
      const last = records[records.length - 1];
      return {
        skillName,
        totalRuns,
        successRuns,
        errorRuns,
        exceptionRuns,
        successRate: totalRuns === 0 ? null : successRuns / totalRuns,
        averageDurationMs: totalRuns === 0
          ? null
          : Math.round(records.reduce((sum, r) => sum + r.durationMs, 0) / totalRuns),
        lastRunAt: last?.finishedAt,
        lastStatus: last?.status,
        lastErrorPreview: last?.errorPreview,
      };
    })
    .sort((a, b) => (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? ''));
}

export function _resetSkillExecutionLogForTests(): void {
  buffer = [];
  loaded = true;
}
