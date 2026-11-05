/**
 * Scheduled prompts. Each run starts a fresh session (owner "schedule:<id>")
 * and can deliver the answer to a chat channel or webhook. Runs are
 * unattended: tools that need approval wait for someone to approve in the web
 * UI and are denied when the approval times out.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValidCronInput, matchesCron, nextRunDate, normalizeCron } from './cron';
import { deliver, type DeliveryTarget } from './channels/notify';
import type { Runtime } from './runtime';
import type { TurnStopReason } from './types';
import { atomicWriteJsonSync, withFileLockSync } from './util/jsonFile';

export interface Schedule {
  id: string;
  name: string;
  /** 5-field cron in server local time ("0 9 * * 1-5") — "HH:MM" is accepted on input. */
  cron: string;
  prompt: string;
  enabled: boolean;
  model?: string;
  deliver?: DeliveryTarget;
  createdAt: string;
  lastRunAt?: string;
  lastStatus?: TurnStopReason;
  lastSessionId?: string;
  lastError?: string;
}

interface LegacySchedule {
  id: string; name?: string; cron: string; prompt: string; enabled?: boolean; createdAt?: string;
  lastRun?: string; discordChannelId?: string; lineUserId?: string;
}

function normalize(raw: Schedule & LegacySchedule): Schedule {
  const target: DeliveryTarget | undefined = raw.deliver
    ?? (raw.discordChannelId ? { channel: 'discord', to: raw.discordChannelId } : undefined)
    ?? (raw.lineUserId ? { channel: 'line', to: raw.lineUserId } : undefined);
  return {
    id: raw.id,
    name: raw.name || raw.prompt.slice(0, 30),
    cron: normalizeCron(raw.cron),
    prompt: raw.prompt,
    enabled: raw.enabled !== false,
    model: raw.model,
    deliver: target,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    lastRunAt: raw.lastRunAt ?? raw.lastRun,
    lastStatus: raw.lastStatus,
    lastSessionId: raw.lastSessionId,
    lastError: raw.lastError,
  };
}

export class ScheduleStore {
  readonly file: string;

  constructor(dataDir: string, private readonly legacyFile?: string) {
    this.file = path.join(dataDir, 'schedules.json');
  }

  list(): Schedule[] {
    const source = fs.existsSync(this.file) ? this.file : this.legacyFile && fs.existsSync(this.legacyFile) ? this.legacyFile : undefined;
    if (!source) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(source, 'utf8')) as { schedules?: Array<Schedule & LegacySchedule> };
      return (parsed.schedules ?? []).filter(s => s?.id && s.prompt && s.cron).map(normalize);
    } catch {
      return [];
    }
  }

  private mutate<T>(fn: (schedules: Schedule[]) => T): T {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    return withFileLockSync(this.file, () => {
      const schedules = this.list();
      const out = fn(schedules);
      atomicWriteJsonSync(this.file, { schedules });
      return out;
    });
  }

  /** Find by id or unique id prefix. */
  find(idOrPrefix: string): Schedule | undefined {
    const all = this.list();
    return all.find(s => s.id === idOrPrefix) ?? (() => {
      const matches = all.filter(s => s.id.startsWith(idOrPrefix));
      return matches.length === 1 ? matches[0] : undefined;
    })();
  }

  add(input: { name?: string; cron: string; prompt: string; model?: string; deliver?: DeliveryTarget; enabled?: boolean }): Schedule {
    if (!isValidCronInput(input.cron)) throw new Error(`cron 式が不正です: ${input.cron}（例: "0 9 * * *" または "09:00"）`);
    if (!input.prompt?.trim()) throw new Error('prompt は必須です');
    const schedule: Schedule = {
      id: randomUUID().slice(0, 8),
      name: input.name?.trim() || input.prompt.trim().slice(0, 30),
      cron: normalizeCron(input.cron),
      prompt: input.prompt.trim(),
      enabled: input.enabled ?? true,
      model: input.model,
      deliver: input.deliver,
      createdAt: new Date().toISOString(),
    };
    this.mutate(list => { list.push(schedule); });
    return schedule;
  }

  update(id: string, patch: Partial<Omit<Schedule, 'id' | 'createdAt'>>): Schedule | undefined {
    if (patch.cron !== undefined) {
      if (!isValidCronInput(patch.cron)) throw new Error(`cron 式が不正です: ${patch.cron}`);
      patch.cron = normalizeCron(patch.cron);
    }
    return this.mutate(list => {
      const s = list.find(x => x.id === id);
      if (s) Object.assign(s, patch);
      return s;
    });
  }

  remove(id: string): boolean {
    return this.mutate(list => {
      const i = list.findIndex(s => s.id === id);
      if (i >= 0) list.splice(i, 1);
      return i >= 0;
    });
  }
}

export function describeNextRun(s: Schedule, from = new Date()): string | undefined {
  return nextRunDate(s.cron, from)?.toISOString();
}

export class Scheduler {
  private timer?: NodeJS.Timeout;
  private readonly running = new Set<string>();
  private lastMinute = '';

  constructor(private readonly runtime: Runtime, readonly store: ScheduleStore) {}

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  async tick(now = new Date()): Promise<void> {
    const minute = now.toISOString().slice(0, 16);
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    for (const s of this.store.list()) {
      if (s.enabled && matchesCron(s.cron, now) && !this.running.has(s.id)) void this.run(s.id).catch(() => undefined);
    }
  }

  /** Run one schedule now and wait for the result. */
  async run(id: string): Promise<Schedule> {
    const s = this.store.find(id);
    if (!s) throw new Error(`スケジュールが見つかりません: ${id}`);
    if (this.running.has(s.id)) throw new Error(`「${s.name}」は実行中です`);
    this.running.add(s.id);
    try {
      const { sessionId, result } = await this.runtime.start(s.prompt, { owner: `schedule:${s.id}`, title: `⏰ ${s.name}`, model: s.model });
      const r = await result;
      let error = r.error;
      if (s.deliver && r.text) {
        try { await deliver(s.deliver, `⏰ ${s.name}\n\n${r.text}`); } catch (err) { error = `配信に失敗しました: ${err instanceof Error ? err.message : String(err)}`; }
      }
      return this.store.update(s.id, { lastRunAt: new Date().toISOString(), lastStatus: r.stopReason, lastSessionId: sessionId, lastError: error }) ?? s;
    } catch (err) {
      return this.store.update(s.id, { lastRunAt: new Date().toISOString(), lastStatus: 'error', lastError: err instanceof Error ? err.message : String(err) }) ?? s;
    } finally {
      this.running.delete(s.id);
    }
  }
}

const schedulers = new WeakMap<Runtime, Scheduler>();

/** One scheduler per runtime (the runtime itself is a process-wide singleton). */
export function getScheduler(runtime: Runtime): Scheduler {
  let scheduler = schedulers.get(runtime);
  if (!scheduler) {
    scheduler = new Scheduler(runtime, new ScheduleStore(runtime.config.dataDir, path.join(runtime.config.projectRoot, 'schedules.json')));
    schedulers.set(runtime, scheduler);
  }
  return scheduler;
}
