import { describe, it, expect } from 'vitest';
import { checkHireRange, fromLocalYmd, hireDays, toLocalYmd } from '@/lib/rental/dates';

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
