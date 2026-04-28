/**
 * CopHarness Scheduler CLI
 *
 * Usage:
 *   npm run schedule list
 *   npm run schedule add <cron> <prompt> [--name <name>]
 *   npm run schedule remove <id>
 *   npm run schedule enable <id>
 *   npm run schedule disable <id>
 *   npm run schedule run
 *
 * Cron format: 5-field "min hour day month weekday"
 *   e.g. "0 9 * * *"  (daily at 09:00)
 *        "* /15 * * * *"  (every 15 minutes — remove space before /)
 * Shorthand: "HH:MM"  e.g. "09:30"  →  daily at 09:30
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

import {
  listSchedules,
  addSchedule,
  removeSchedule,
  setEnabled,
} from '../lib/scheduler/store';
import { normalizeCron, nextRunDate } from '../lib/scheduler/cron';
import { startScheduler } from '../lib/scheduler/engine';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

function printHelp(): void {
  console.log(`
CopHarness Scheduler

Commands:
  list                          List all scheduled prompts
  add <cron> <prompt>           Add a new schedule
    --name <name>               Optional label (default: "Unnamed")
  remove <id>                   Remove a schedule by ID (prefix match)
  enable <id>                   Enable a schedule
  disable <id>                  Disable a schedule
  run                           Start the scheduler daemon

Cron format:
  "HH:MM"                       Daily at given time  e.g. "09:00"
  "min hour day month weekday"  Standard 5-field cron e.g. "0 9 * * *"
  Supported: *, N, N-M, */N, N,M

Examples:
  npm run schedule add "09:00" "What should I focus on today?" --name "Morning"
  npm run schedule add "0 18 * * 5" "Weekly summary?" --name "Friday recap"
  npm run schedule add "*/30 * * * *" "Ping"
  npm run schedule list
  npm run schedule remove abc123
  npm run schedule run
`);
}

function resolveId(prefix: string): string | null {
  const schedules = listSchedules();
  const match = schedules.find((s) => s.id.startsWith(prefix));
  return match?.id ?? null;
}

// ── commands ──────────────────────────────────────────────────────────────────

function cmdList(): void {
  const schedules = listSchedules();
  if (schedules.length === 0) {
    console.log('No scheduled prompts registered.');
    return;
  }

  const now = new Date();
  const rows = schedules.map((s) => {
    const next = s.enabled ? nextRunDate(normalizeCron(s.cron), now) : null;
    return {
      id: s.id.slice(0, 8),
      name: s.name,
      cron: s.cron,
      status: s.enabled ? 'enabled' : 'disabled',
      lastRun: formatDate(s.lastRun),
      nextRun: next ? next.toLocaleString() : '-',
      prompt: s.prompt.length > 50 ? s.prompt.slice(0, 47) + '...' : s.prompt,
    };
  });

  // Determine column widths
  const cols = ['id', 'name', 'cron', 'status', 'lastRun', 'nextRun', 'prompt'] as const;
  const headers: Record<(typeof cols)[number], string> = {
    id: 'ID',
    name: 'Name',
    cron: 'Cron',
    status: 'Status',
    lastRun: 'Last Run',
    nextRun: 'Next Run',
    prompt: 'Prompt',
  };
  const widths = cols.reduce(
    (acc, c) => {
      acc[c] = Math.max(headers[c].length, ...rows.map((r) => r[c].length));
      return acc;
    },
    {} as Record<(typeof cols)[number], number>,
  );

  const sep = cols.map((c) => '-'.repeat(widths[c])).join('-+-');
  const header = cols.map((c) => headers[c].padEnd(widths[c])).join(' | ');
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(cols.map((c) => row[c].padEnd(widths[c])).join(' | '));
  }
  console.log(`\nTotal: ${schedules.length}`);
}

function cmdAdd(args: string[]): void {
  if (args.length < 2) {
    console.error('Usage: schedule add <cron> <prompt> [--name <name>]');
    process.exit(1);
  }

  const [cron, prompt] = args;
  let name = 'Unnamed';

  const nameIdx = args.indexOf('--name');
  if (nameIdx !== -1 && args[nameIdx + 1]) {
    name = args[nameIdx + 1];
  }

  // Validate cron
  try {
    normalizeCron(cron);
  } catch {
    console.error(`Invalid cron expression: "${cron}"`);
    process.exit(1);
  }

  const entry = addSchedule({ name, cron, prompt });
  console.log(`Schedule added (ID: ${entry.id})`);
  console.log(`  Name:  ${entry.name}`);
  console.log(`  Cron:  ${entry.cron}`);
  console.log(`  Prompt: ${entry.prompt}`);

  const next = nextRunDate(normalizeCron(cron), new Date());
  if (next) {
    console.log(`  Next run: ${next.toLocaleString()}`);
  }
}

function cmdRemove(args: string[]): void {
  const prefix = args[0];
  if (!prefix) {
    console.error('Usage: schedule remove <id>');
    process.exit(1);
  }
  const id = resolveId(prefix);
  if (!id) {
    console.error(`No schedule found with ID prefix: ${prefix}`);
    process.exit(1);
  }
  removeSchedule(id);
  console.log(`Schedule ${id} removed.`);
}

function cmdSetEnabled(args: string[], enabled: boolean): void {
  const prefix = args[0];
  if (!prefix) {
    console.error(`Usage: schedule ${enabled ? 'enable' : 'disable'} <id>`);
    process.exit(1);
  }
  const id = resolveId(prefix);
  if (!id) {
    console.error(`No schedule found with ID prefix: ${prefix}`);
    process.exit(1);
  }
  setEnabled(id, enabled);
  console.log(`Schedule ${id} ${enabled ? 'enabled' : 'disabled'}.`);
}

// ── main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case 'list':
      cmdList();
      break;
    case 'add':
      cmdAdd(rest);
      break;
    case 'remove':
    case 'delete':
    case 'rm':
      cmdRemove(rest);
      break;
    case 'enable':
      cmdSetEnabled(rest, true);
      break;
    case 'disable':
      cmdSetEnabled(rest, false);
      break;
    case 'run':
      startScheduler();
      break;
    default:
      printHelp();
      if (command && command !== '--help' && command !== '-h') {
        console.error(`Unknown command: ${command}`);
        process.exit(1);
      }
  }
}

main();
