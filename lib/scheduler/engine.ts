import { listSchedules, setRunNow, setStopRequested, updateLastRun } from './store';
import { matchesCron, normalizeCron, isValidCronInput } from './cron';
import { createAdapterWithFallback, resolveProvider, resolveModel, resolveApiKey } from '../adapterFactory';
import type { LLMMessage } from '../adapter';
import { startLog, finishLog } from '../logs/store';
import { runWithRalphLoop } from '../context/ralphLoop';
import { withSkillExecutionContext } from '../skills/executionContext';
import { finishTask, startTask } from '../tasks/ledger';
import {
  isAbortError,
  registerTaskAbortController,
  unregisterTaskAbortController,
} from '../tasks/cancellation';
import type { ScheduledPrompt } from './types';
import '../skills/index';
import { listActiveSkills, resolveSkills } from '../skill';
import { resolveToolsetSkillNames } from '../skills/toolsets';

/**
 * Optional callback invoked after a schedule successfully completes.
 * Used by the Discord bot to post results back to a channel.
 */
export type ScheduleResultCallback = (
  channelId: string,
  scheduleName: string,
  payload: { status: 'success' | 'failed' | 'aborted'; message: string },
) => Promise<void>;

/** Push a text message to a LINE user via the Messaging API. */
async function sendLinePush(userId: string, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  const truncated = text.length > 5000 ? text.slice(0, 5000) : text;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: truncated }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed (${res.status}): ${body}`);
  }
}

export interface ScheduledPromptRunContext {
  schedule?: Pick<ScheduledPrompt, 'id' | 'name' | 'discordChannelId' | 'lineUserId'>;
  watcher?: {
    id: string;
    name: string;
    type: string;
    discordChannelId?: string;
    lineUserId?: string;
  };
  reason: 'manual fire' | 'cron' | string;
  event?: unknown;
  /** Named toolsets restricting which skills are available for this run. */
  toolsets?: string[];
}

function automationChannelKey(target: Pick<ScheduledPrompt, 'discordChannelId' | 'lineUserId'>): string | undefined {
  if (target.lineUserId) return `line:${target.lineUserId}`;
  if (target.discordChannelId) return `discord-channel:${target.discordChannelId}`;
  return undefined;
}

function automationTaskInput(context: ScheduledPromptRunContext): {
  kind: 'schedule' | 'watcher';
  channelKey?: string;
  title: string;
  metadata: Record<string, unknown>;
} {
  if (context.watcher) {
    return {
      kind: 'watcher',
      channelKey: automationChannelKey(context.watcher),
      title: context.watcher.name,
      metadata: {
        watcherId: context.watcher.id,
        watcherName: context.watcher.name,
        watcherType: context.watcher.type,
        reason: context.reason,
        event: context.event,
      },
    };
  }

  const schedule = context.schedule;
  if (!schedule) throw new Error('scheduledContext requires either schedule or watcher');
  return {
    kind: 'schedule',
    channelKey: automationChannelKey(schedule),
    title: schedule.name,
    metadata: {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      reason: context.reason,
    },
  };
}

/** Execute a single prompt against the configured LLM and return the response text. */
export async function runPrompt(
  prompt: string,
  abortSignal?: AbortSignal,
  scheduledContext?: ScheduledPromptRunContext,
): Promise<string> {
  const provider = resolveProvider();
  const apiKey = typeof resolveApiKey === 'function' ? resolveApiKey(provider) : undefined;
  const model = resolveModel(provider);

  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const adapter = createAdapterWithFallback({ provider, model, apiKey, timeoutMs });

  const messages: LLMMessage[] = [];
  const sys = process.env.COPILOT_SYSTEM_PROMPT;
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: prompt });

  const toolsetNames = scheduledContext?.toolsets;
  const skills =
    toolsetNames && toolsetNames.length > 0
      ? resolveSkills(resolveToolsetSkillNames(toolsetNames))
      : listActiveSkills();

  const execute = async (signal?: AbortSignal) => {
    const resp = await runWithRalphLoop(
      { messages, timeoutMs, abortSignal: signal, skills },
      adapter,
      { originalGoal: prompt },
    );
    return resp.content;
  };

  try {
    if (!scheduledContext) return await execute(abortSignal);

    const task = await startTask(automationTaskInput(scheduledContext));
    // Register a task-scoped controller so chat "stop <taskId>" can abort the
    // in-flight LLM call, in addition to the schedule-level stopRequested flag.
    const taskAbort = new AbortController();
    registerTaskAbortController(task.id, taskAbort);
    const signal = abortSignal
      ? AbortSignal.any([abortSignal, taskAbort.signal])
      : taskAbort.signal;

    try {
      const result = await withSkillExecutionContext(
        { channelKey: task.channelKey, taskId: task.id },
        () => execute(signal),
      );
      await finishTask(task.id, 'succeeded');
      return result;
    } catch (err) {
      // A stop through the cancellation registry already finished the ledger
      // entry as cancelled; do not overwrite it.
      if (!taskAbort.signal.aborted) {
        await finishTask(task.id, isAbortError(err) ? 'cancelled' : 'failed', err);
      }
      throw err;
    } finally {
      unregisterTaskAbortController(task.id);
    }
  } finally {
    if (adapter.destroy) await adapter.destroy();
  }
}

/** AbortControllers for currently in-flight schedule runs, keyed by schedule ID. */
const activeRuns = new Map<string, AbortController>();

/**
 * Resolve a schedule timing string to a valid 5-field cron expression.
 * If the input is already a valid cron or HH:MM shorthand, return it unchanged.
 * Otherwise, call the LLM to interpret the natural language description.
 *
 * Examples:
 *   "09:00"      → "0 9 * * *"  (HH:MM shorthand)
 *   "0 9 * * *"  → "0 9 * * *"  (already valid)
 *   "毎日朝9時"   → "0 9 * * *"  (via LLM)
 *   "every friday at 18:00" → "0 18 * * 5"  (via LLM)
 */
export async function resolveCronExpression(input: string): Promise<string> {
  if (isValidCronInput(input)) return input;

  const prompt =
    `You are a cron expression converter. Convert the following schedule description to a ` +
    `standard 5-field cron expression (minute hour day month weekday). ` +
    `Reply with ONLY the cron expression and nothing else.\n` +
    `Examples:\n` +
    `- "毎日朝9時" → 0 9 * * *\n` +
    `- "毎週金曜18時" → 0 18 * * 5\n` +
    `- "30分おき" → */30 * * * *\n` +
    `- "every weekday at 8am" → 0 8 * * 1-5\n` +
    `- "every 15 minutes" → */15 * * * *\n` +
    `Schedule description: ${input}`;

  const result = (await runPrompt(prompt)).trim();
  // Strip any surrounding quotes or backticks the LLM might add
  const cleaned = result.replace(/^["'`]|["'`]$/g, '').trim();

  if (!isValidCronInput(cleaned)) {
    throw new Error(
      `"${input}" を有効なcron式に変換できませんでした (LLM応答: "${cleaned}")`,
    );
  }
  return cleaned;
}

/** Last minute boundary at which cron expressions were evaluated. */
let lastCronMinute = -1;

/** Callback to notify external consumers (e.g. Discord) of a completed schedule result. */
let resultCallback: ScheduleResultCallback | undefined;

/** Prevents startScheduler from being called more than once in the same process. */
let schedulerStarted = false;

/**
 * Poll tick: called every POLL_INTERVAL_MS.
 * - Fires schedules whose runNow flag is set (immediate execution).
 * - At each new minute boundary, evaluates cron expressions.
 * - Cancels in-flight runs whose stopRequested flag is set.
 */
async function tick(): Promise<void> {
  const now = new Date();
  const currentMinute =
    now.getFullYear() * 100000000 +
    (now.getMonth() + 1) * 1000000 +
    now.getDate() * 10000 +
    now.getHours() * 100 +
    now.getMinutes();

  const isCronMinute = currentMinute !== lastCronMinute;
  if (isCronMinute) lastCronMinute = currentMinute;

  const minuteDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
  );

  for (const schedule of listSchedules()) {
    // Handle stop requests for in-flight runs
    if (schedule.stopRequested && activeRuns.has(schedule.id)) {
      activeRuns.get(schedule.id)!.abort();
      setStopRequested(schedule.id, false);
      continue;
    }

    // Skip if already running
    if (activeRuns.has(schedule.id)) continue;

    const runNow = schedule.runNow === true;

    const cronDue = (() => {
      if (!isCronMinute || !schedule.enabled) return false;
      if (!matchesCron(normalizeCron(schedule.cron), minuteDate)) return false;
      if (schedule.lastRun) {
        const last = new Date(schedule.lastRun);
        const lastMin = new Date(
          last.getFullYear(),
          last.getMonth(),
          last.getDate(),
          last.getHours(),
          last.getMinutes(),
        );
        if (lastMin.getTime() === minuteDate.getTime()) return false;
      }
      return true;
    })();

    if (!runNow && !cronDue) continue;

    // Clear the runNow flag before launching so re-polling doesn't re-fire
    if (runNow) setRunNow(schedule.id, false);

    // Record lastRun immediately (before the prompt executes) so that any other
    // daemon process reading the same schedules.json in the same minute will see
    // this schedule as already fired and skip it — preventing cross-process
    // double execution.
    updateLastRun(schedule.id, now);

    const controller = new AbortController();
    activeRuns.set(schedule.id, controller);

    const ts = now.toISOString();
    const reason = runNow ? 'manual fire' : 'cron';
    console.log(`[${ts}] Schedule "${schedule.name}" (${schedule.id.slice(0, 8)}) firing [${reason}]`);

    const logId = startLog({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      prompt: schedule.prompt,
      reason,
    });

    // Launch async without awaiting — daemon stays unblocked
    runPrompt(schedule.prompt, controller.signal, { schedule, reason, toolsets: schedule.toolsets })
      .then(async (result) => {
        finishLog(await logId, 'success', result);
        console.log(`[${ts}] Response from "${schedule.name}":\n${result}\n`);
        // Notify Discord channel if configured
        if (resultCallback && schedule.discordChannelId) {
          resultCallback(schedule.discordChannelId, schedule.name, {
            status: 'success',
            message: result,
          }).catch((err: unknown) => {
            console.error(`[${ts}] Failed to send Discord notification for "${schedule.name}":`, err);
          });
        }
        // Notify LINE user if configured
        if (schedule.lineUserId) {
          sendLinePush(
            schedule.lineUserId,
            `スケジュール実行完了: ${schedule.name}\n\n${result}`,
          ).catch((err: unknown) => {
            console.error(`[${ts}] Failed to send LINE notification for "${schedule.name}":`, err);
          });
        }
      })
      .catch(async (err: unknown) => {
        const name = err instanceof Error ? err.name : '';
        if (name === 'AbortError') {
          finishLog(await logId, 'aborted');
          console.log(`[${ts}] Schedule "${schedule.name}" stopped (aborted).`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          finishLog(await logId, 'failed', msg);
          console.error(`[${ts}] Schedule "${schedule.name}" failed: ${msg}`);
          if (resultCallback && schedule.discordChannelId) {
            resultCallback(schedule.discordChannelId, schedule.name, {
              status: 'failed',
              message: msg,
            }).catch((notifyErr: unknown) => {
              console.error(`[${ts}] Failed to send Discord notification for "${schedule.name}":`, notifyErr);
            });
          }
          if (schedule.lineUserId) {
            sendLinePush(
              schedule.lineUserId,
              `スケジュール実行失敗: ${schedule.name}\n\nエラー: ${msg}`,
            ).catch((notifyErr: unknown) => {
              console.error(`[${ts}] Failed to send LINE notification for "${schedule.name}":`, notifyErr);
            });
          }
        }
      })
      .finally(() => {
        activeRuns.delete(schedule.id);
      });
  }
}

/** How often the daemon polls for runNow / stopRequested / new-minute cron checks. */
const POLL_INTERVAL_MS = 5_000;

/** Start the scheduler daemon. Returns true if started, false if already running. */
export function startScheduler(onResult?: ScheduleResultCallback): boolean {
  if (schedulerStarted) {
    console.warn('Scheduler daemon is already running — ignoring duplicate startScheduler() call.');
    if (onResult) resultCallback = onResult;
    return false;
  }
  schedulerStarted = true;
  if (onResult) resultCallback = onResult;
  console.log('Scheduler daemon started (polling every 5 s). Press Ctrl+C to stop.');

  const interval = setInterval(() => {
    tick().catch((err) => console.error('Scheduler tick error:', err));
  }, POLL_INTERVAL_MS);

  // Run an immediate first tick so the daemon reacts quickly at startup
  tick().catch((err) => console.error('Scheduler tick error:', err));

  const shutdown = () => {
    clearInterval(interval);
    // Abort all in-flight runs
    for (const [id, controller] of activeRuns) {
      console.log(`Aborting in-flight run for schedule ${id.slice(0, 8)}…`);
      controller.abort();
    }
    activeRuns.clear();
    schedulerStarted = false;
    console.log('\nScheduler stopped.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return true;
}
