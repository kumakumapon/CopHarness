/**
 * Minimal cron expression evaluator.
 * Supports 5-field cron: "min hour day month weekday"
 * Each field: *, N, N-M, *\/N, N-M/N, N,M,...
 */

function matchField(field: string, value: number): boolean {
  if (field.includes(',')) {
    return field.split(',').some((f) => matchField(f.trim(), value));
  }

  if (field.includes('/')) {
    const [rangeStr, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    if (rangeStr === '*') {
      return value % step === 0;
    }
    if (rangeStr.includes('-')) {
      const [lo, hi] = rangeStr.split('-').map(Number);
      if (value < lo || value > hi) return false;
      return (value - lo) % step === 0;
    }
    const start = parseInt(rangeStr, 10);
    return value >= start && (value - start) % step === 0;
  }

  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    return value >= lo && value <= hi;
  }

  if (field === '*') return true;

  return value === parseInt(field, 10);
}

/** Check whether a Date matches a 5-field cron expression. */
export function matchesCron(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minF, hourF, dayF, monthF, wdayF] = fields;
  return (
    matchField(minF, date.getMinutes()) &&
    matchField(hourF, date.getHours()) &&
    matchField(dayF, date.getDate()) &&
    matchField(monthF, date.getMonth() + 1) &&
    (matchField(wdayF, date.getDay()) || (date.getDay() === 0 && matchField(wdayF, 7)))
  );
}

/** Allowed [min, max] for each of the 5 cron fields (weekday accepts 7 = Sunday). */
const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseCronNumber(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** Validate one cron field: *, N, N-M, *\/N, N-M/N, N/N and comma lists of those. */
function isValidField(field: string, min: number, max: number): boolean {
  if (field === '') return false;
  return field.split(',').every((part) => {
    const [range, step, extra] = part.split('/');
    if (extra !== undefined) return false;
    if (step !== undefined && (parseCronNumber(step, 1, max) === null)) return false;
    if (range === '*') return true;
    const bounds = range.split('-');
    if (bounds.length > 2) return false;
    const lo = parseCronNumber(bounds[0], min, max);
    if (lo === null) return false;
    if (bounds.length === 2) {
      const hi = parseCronNumber(bounds[1], min, max);
      return hi !== null && lo <= hi;
    }
    return true;
  });
}

/**
 * Return true if the input is a valid cron expression (5-field or HH:MM
 * shorthand). Every field is range-checked, so out-of-range expressions that
 * could never fire (e.g. "0 25 * * *", "0 0 32 * *") are rejected. Calendar
 * impossibilities such as "0 0 31 2 *" are still accepted.
 */
export function isValidCronInput(input: string): boolean {
  const fields = normalizeCron(input).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f, i) => isValidField(f, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
}

/**
 * Convert HH:MM shorthand to a 5-field cron expression.
 * "09:30" → "30 9 * * *"
 */
export function normalizeCron(cron: string): string {
  const m = cron.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    return `${parseInt(m[2], 10)} ${parseInt(m[1], 10)} * * *`;
  }
  return cron;
}

/** Return next Date (≥ fromDate) that matches the cron expression, or null if not found within a week. */
export function nextRunDate(cron: string, fromDate: Date): Date | null {
  const normalized = normalizeCron(cron);
  // Start from the next minute
  const candidate = new Date(fromDate.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  while (candidate <= limit) {
    if (matchesCron(normalized, candidate)) return new Date(candidate);
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}
