import { isValidCronInput, matchesCron, nextRunDate } from '../../lib/scheduler/cron';

describe('isValidCronInput', () => {
  it.each([
    '* * * * *',
    '0 9 * * *',
    '*/15 * * * *',
    '0 8 * * 1-5',
    '0,30 9-17 * * *',
    '0 0 1 1 *',
    '5-55/10 * * * *',
    '0 0 * * 7',
    '09:30',
    '9:05',
  ])('accepts %s', (input) => {
    expect(isValidCronInput(input)).toBe(true);
  });

  it.each([
    '0 25 * * *',
    '60 * * * *',
    '0 0 0 * *',
    '0 0 32 * *',
    '0 0 * 13 *',
    '0 0 * 0 *',
    '0 0 * * 8',
    '25:00',
    '12:60',
    '* * * *',
    '* * * * * *',
    'a b c d e',
    '5-1 * * * *',
    '*/0 * * * *',
    '*/x * * * *',
    '1-2-3 * * * *',
    '1//2 * * * *',
    ', * * * *',
    '',
  ])('rejects %s', (input) => {
    expect(isValidCronInput(input)).toBe(false);
  });
});

describe('weekday 7 means Sunday', () => {
  it('matches Sunday for both 0 and 7', () => {
    const sunday = new Date(2026, 9, 11, 9, 0); // 2026-10-11 is a Sunday
    expect(sunday.getDay()).toBe(0);
    expect(matchesCron('0 9 * * 0', sunday)).toBe(true);
    expect(matchesCron('0 9 * * 7', sunday)).toBe(true);
    expect(matchesCron('0 9 * * 1', sunday)).toBe(false);
  });

  it('finds the next run for a valid expression', () => {
    expect(nextRunDate('30 9 * * *', new Date(2026, 9, 11, 9, 0))?.getMinutes()).toBe(30);
  });
});
