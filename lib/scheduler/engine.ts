import { listSchedules, updateLastRun } from './store';
import { matchesCron, normalizeCron } from './cron';
import { createAdapter, resolveProvider } from '../adapterFactory';
import type { LLMMessage } from '../adapter';

/** Execute a single prompt against the configured LLM and return the response text. */
export async function runPrompt(prompt: string): Promise<string> {
  const provider = resolveProvider();
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ||
    process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY;

  const model =
    process.env.COPILOT_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.GEMINI_MODEL ||
    'gpt-5-mini';

  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const adapter = createAdapter({ provider, model, apiKey, timeoutMs });

  const messages: LLMMessage[] = [];
  const sys = process.env.COPILOT_SYSTEM_PROMPT;
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: prompt });

  try {
    const resp = await adapter.complete({ messages, timeoutMs });
    return resp.content;
  } finally {
    if (adapter.destroy) await adapter.destroy();
  }
}

function msUntilNextMinute(): number {
  const now = new Date();
  return (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
}

/**
 * Run one scheduler tick: check all enabled schedules against the current time
 * and execute any that are due.
 */
async function tick(): Promise<void> {
  const now = new Date();
  // Truncate to minute precision for cron matching
  const minute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());

  for (const schedule of listSchedules()) {
    if (!schedule.enabled) continue;

    const cron = normalizeCron(schedule.cron);
    if (!matchesCron(cron, minute)) continue;

    // Skip if already ran this exact minute
    if (schedule.lastRun) {
      const last = new Date(schedule.lastRun);
      const lastMinute = new Date(last.getFullYear(), last.getMonth(), last.getDate(), last.getHours(), last.getMinutes());
      if (lastMinute.getTime() === minute.getTime()) continue;
    }

    const ts = now.toISOString();
    console.log(`[${ts}] Schedule "${schedule.name}" (${schedule.id.slice(0, 8)}) firing`);

    try {
      const result = await runPrompt(schedule.prompt);
      await updateLastRun(schedule.id, now);
      console.log(`[${ts}] Response:\n${result}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${ts}] Schedule "${schedule.name}" failed: ${msg}`);
    }
  }
}

/** Start the scheduler daemon. Aligns to minute boundaries and fires until SIGINT/SIGTERM. */
export function startScheduler(): void {
  console.log('Scheduler daemon started. Waiting for next minute boundary...');

  let interval: ReturnType<typeof setInterval>;

  const onMinute = () => {
    tick().catch((err) => console.error('Scheduler tick error:', err));
    interval = setInterval(() => {
      tick().catch((err) => console.error('Scheduler tick error:', err));
    }, 60_000);
  };

  setTimeout(onMinute, msUntilNextMinute());

  const shutdown = () => {
    clearInterval(interval);
    console.log('\nScheduler stopped.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
