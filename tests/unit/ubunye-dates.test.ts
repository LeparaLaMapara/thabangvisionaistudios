import { describe, it, expect } from 'vitest';
import { addDays, clockLine, formatSaDay, isIsoDate, resolveDate, saNow, workingDaysAfter } from '@/lib/dates/johannesburg';

// Saturday 17 October 2026, 10:00 in Johannesburg (08:00 UTC).
const SAT = new Date('2026-10-17T08:00:00Z');
const at = (text: string, now: Date = SAT) => resolveDate(text, now)?.iso ?? null;

describe('saNow: the server clock in Johannesburg time', () => {
  it('gives the date, weekday and time in South Africa', () => {
    expect(saNow(SAT)).toEqual({ iso: '2026-10-17', weekday: 'Saturday', time: '10:00' });
  });
  it('is already tomorrow in Johannesburg at 23:30 UTC', () => {
    expect(saNow(new Date('2026-10-17T23:30:00Z')).iso).toBe('2026-10-18');
  });
  it('the prompt line names the date, the year and the time zone', () => {
    const line = clockLine(SAT);
    expect(line).toContain('Saturday 17 October 2026');
    expect(line).toContain('2026-10-17');
    expect(line).toContain('10:00');
    expect(line).toContain('Africa/Johannesburg');
  });
});

describe('resolveDate: words to one date', () => {
  it('today, tonight, tomorrow, the day after tomorrow', () => {
    expect(at('today')).toBe('2026-10-17');
    expect(at('tonight')).toBe('2026-10-17');
    expect(at('tomorrow')).toBe('2026-10-18');
    expect(at('tomorrow morning')).toBe('2026-10-18');
    expect(at('the day after tomorrow')).toBe('2026-10-19');
    expect(at('in 3 days')).toBe('2026-10-20');
  });

  it('tomorrow is worked out in Johannesburg, not UTC (00:30 SAST is still the day before in UTC)', () => {
    const justAfterMidnightSast = new Date('2026-10-17T22:30:00Z'); // 00:30 on Sunday 18 in Johannesburg
    expect(at('tomorrow', justAfterMidnightSast)).toBe('2026-10-19');
  });

  it('this weekend and next weekend', () => {
    expect(at('this weekend')).toBe('2026-10-17'); // today is Saturday
    expect(at('next weekend')).toBe('2026-10-24');
    const wed = new Date('2026-10-14T08:00:00Z');
    expect(at('this weekend', wed)).toBe('2026-10-17');
    expect(at('weekend', wed)).toBe('2026-10-17');
    expect(at('next weekend', wed)).toBe('2026-10-24');
    const sun = new Date('2026-10-18T08:00:00Z');
    expect(at('this weekend', sun)).toBe('2026-10-18');
    expect(at('next weekend', sun)).toBe('2026-10-24');
  });

  it('weekday names: the next one, "this" can be today, "next" is next week', () => {
    expect(at('Friday')).toBe('2026-10-23');
    expect(at('on fri')).toBe('2026-10-23');
    expect(at('Saturday')).toBe('2026-10-24'); // today is Saturday: the next one
    expect(at('this Saturday')).toBe('2026-10-17');
    expect(at('next Friday')).toBe('2026-10-23'); // Friday of next week (Mon 19 to Sun 25)
    const mon = new Date('2026-10-19T08:00:00Z');
    expect(at('Friday', mon)).toBe('2026-10-23');
    expect(at('next Friday', mon)).toBe('2026-10-30');
  });

  it('written dates, with and without a year', () => {
    expect(at('24 April 2027')).toBe('2027-04-24');
    expect(at('24th of April 2027')).toBe('2027-04-24');
    expect(at('April 24, 2027')).toBe('2027-04-24');
    expect(at('2027-04-24')).toBe('2027-04-24');
    expect(at('24/04/2027')).toBe('2027-04-24'); // day/month/year, the South African way
    expect(at('24 Apr')).toBe('2027-04-24'); // already past this year: the next one
    expect(at('20 October')).toBe('2026-10-20');
    expect(at('17 October')).toBe('2026-10-17');
  });

  it('says how it read the words, so the customer can correct it', () => {
    const r = resolveDate('next weekend', SAT)!;
    expect(r.label).toBe('Saturday 24 October 2026');
    expect(r.rule).toMatch(/weekend after this one/);
  });

  it('gives nothing for words that are not one day', () => {
    expect(resolveDate('next week', SAT)).toBeNull();
    expect(resolveDate('soon', SAT)).toBeNull();
    expect(resolveDate('', SAT)).toBeNull();
    expect(resolveDate('31 February 2027', SAT)).toBeNull();
    expect(resolveDate('2027-02-30', SAT)).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('isIsoDate checks real dates', () => {
    expect(isIsoDate('2026-10-18')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('18 Oct')).toBe(false);
  });
  it('addDays and formatSaDay', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatSaDay('2026-10-18')).toBe('Sunday 18 October 2026');
  });
  it('working days skip the weekend', () => {
    expect(workingDaysAfter('2026-10-17', 1)).toBe('2026-10-19'); // Saturday -> Monday
    expect(workingDaysAfter('2026-10-16', 1)).toBe('2026-10-19'); // Friday -> Monday
    expect(workingDaysAfter('2026-10-19', 1)).toBe('2026-10-20');
    expect(workingDaysAfter('2026-10-19', 2)).toBe('2026-10-21');
  });
});
