import { describe, it, expect } from 'vitest';
import { checkHireRange, fromLocalYmd, hireDays, toLocalYmd } from '@/lib/rental/dates';
import { earliestBookableDate, meetsLeadTime } from '@/lib/rental/leadTime';

/**
 * One date rule for a hire, on the gear page, the cart and the checkout:
 * the return day comes after the pick-up day; the hire is charged for the
 * whole days between them; at most maxBookingDays.
 */

// The checkout's own count (app/api/cart/checkout daysBetween) on YYYY-MM-DD dates.
const checkoutDays = (start: string, end: string): number =>
  Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24));

describe('hireDays', () => {
  it('matches the checkout count for every range in a year', () => {
    const base = fromLocalYmd('2026-01-01')!;
    for (let s = 0; s < 365; s += 7) {
      for (const len of [1, 2, 6, 7, 13, 30]) {
        const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + s);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + len);
        expect(hireDays(start, end)).toBe(checkoutDays(toLocalYmd(start), toLocalYmd(end)));
        expect(hireDays(start, end)).toBe(len);
      }
    }
  });

  it('ignores the time of day', () => {
    expect(hireDays(new Date(2026, 9, 3, 23, 30), new Date(2026, 9, 4, 0, 15))).toBe(1);
  });
});

describe('checkHireRange', () => {
  const d = (ymd: string) => fromLocalYmd(ymd);

  it('a one-day hire is returned the next day', () => {
    expect(checkHireRange(d('2026-10-03'), d('2026-10-04'), 30)).toEqual({ ok: true, days: 1 });
  });

  it('refuses the same day with a hint, instead of getting stuck', () => {
    const r = checkHireRange(d('2026-10-03'), d('2026-10-03'), 30);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe('same_day');
      expect(r.message).toMatch(/next day/);
    }
  });

  it('refuses an incomplete, reversed or too-long range', () => {
    expect(checkHireRange(d('2026-10-03'), null, 30)).toMatchObject({ ok: false, problem: 'incomplete' });
    expect(checkHireRange(d('2026-10-05'), d('2026-10-03'), 30)).toMatchObject({ ok: false, problem: 'end_before_start' });
    expect(checkHireRange(d('2026-10-01'), d('2026-11-01'), 30)).toMatchObject({ ok: false, problem: 'too_long' });
    expect(checkHireRange(d('2026-10-01'), d('2026-10-31'), 30)).toEqual({ ok: true, days: 30 });
  });
});

describe('checkHireRange with the first bookable day (lead time, past dates)', () => {
  const d = (s: string) => fromLocalYmd(s)!;
  // Friday 9 October 2026 at 14:00: with 48 hours' notice the first bookable day is Monday 12 October.
  const now = new Date(2026, 9, 9, 14, 0, 0);
  const earliest = earliestBookableDate(now, 48);

  it('refuses a start before the first bookable day, naming it, and says "Choose new dates"', () => {
    expect(toLocalYmd(earliest)).toBe('2026-10-12');
    const tooSoon = checkHireRange(d('2026-10-11'), d('2026-10-13'), 30, earliest);
    expect(tooSoon).toMatchObject({ ok: false, problem: 'too_soon' });
    expect(tooSoon.ok ? '' : tooSoon.message).toMatch(/Choose new dates/);
    expect(tooSoon.ok ? '' : tooSoon.message).toMatch(/12 October/);
    expect(checkHireRange(d('2026-10-01'), d('2026-10-03'), 30, earliest)).toMatchObject({ ok: false, problem: 'too_soon' });
  });

  it('accepts the first bookable day and later, and agrees with the checkout rule', () => {
    expect(checkHireRange(d('2026-10-12'), d('2026-10-13'), 30, earliest)).toEqual({ ok: true, days: 1 });
    for (const start of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-15']) {
      const ok = checkHireRange(d(start), d('2026-10-20'), 30, earliest).ok;
      expect(ok).toBe(meetsLeadTime(d(start), now, 48));
    }
  });

  it('without a first bookable day the rule is unchanged (callers that do not pass it)', () => {
    expect(checkHireRange(d('2020-01-01'), d('2020-01-02'), 30)).toEqual({ ok: true, days: 1 });
  });
});
