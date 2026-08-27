import { describe, it, expect } from 'vitest';
import {
  earliestStart,
  earliestBookableDate,
  meetsLeadTime,
  leadTimeMessage,
  toDateInputValue,
  startOfDay,
} from '@/lib/rental/leadTime';
import { STUDIO } from '@/lib/constants';

/** Friday 2026-09-04 at 14:00 local. */
const FRIDAY_AFTERNOON = new Date(2026, 8, 4, 14, 0, 0, 0);
/** Friday 2026-09-04 at 00:05 local — booked just after midnight. */
const FRIDAY_MIDNIGHT = new Date(2026, 8, 4, 0, 5, 0, 0);

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('the constant', () => {
  it('is 48 hours', () => {
    expect(STUDIO.rental.minLeadTimeHours).toBe(48);
  });
});

describe('earliestBookableDate', () => {
  it('refuses the day the cutoff lands in, because that day starts too soon', () => {
    // Friday 14:00 + 48h = Sunday 14:00. Sunday STARTS at 00:00, which is only
    // 34 hours away, so Sunday does not qualify. Monday does.
    expect(earliestBookableDate(FRIDAY_AFTERNOON)).toEqual(d(2026, 9, 7)); // Monday
  });

  it('allows the cutoff day when the cutoff falls exactly at midnight', () => {
    const midnight = new Date(2026, 8, 4, 0, 0, 0, 0);
    // Friday 00:00 + 48h = Sunday 00:00 exactly, so Sunday qualifies.
    expect(earliestBookableDate(midnight)).toEqual(d(2026, 9, 6)); // Sunday
  });

  it('gives a late-night booker the same day a midday booker would get', () => {
    // 00:05 + 48h = Sunday 00:05, so Sunday starts 5 minutes too early.
    expect(earliestBookableDate(FRIDAY_MIDNIGHT)).toEqual(d(2026, 9, 7)); // Monday
  });
});

describe('meetsLeadTime', () => {
  it('refuses today', () => {
    expect(meetsLeadTime('2026-09-04', FRIDAY_AFTERNOON)).toBe(false);
  });

  it('refuses tomorrow', () => {
    expect(meetsLeadTime('2026-09-05', FRIDAY_AFTERNOON)).toBe(false);
  });

  it('refuses the day after tomorrow when booked in the afternoon', () => {
    // The case the whole module exists for: two calendar days, but 34 hours.
    expect(meetsLeadTime('2026-09-06', FRIDAY_AFTERNOON)).toBe(false);
  });

  it('accepts the third day', () => {
    expect(meetsLeadTime('2026-09-07', FRIDAY_AFTERNOON)).toBe(true);
  });

  it('accepts anything further out', () => {
    expect(meetsLeadTime('2026-12-25', FRIDAY_AFTERNOON)).toBe(true);
  });

  it('never gives less than 48 hours, whatever the hour of booking', () => {
    // Sweep every hour of a day and assert the invariant holds each time.
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(2026, 8, 4, hour, 30, 0, 0);
      const first = earliestBookableDate(now);
      const noticeHours = (first.getTime() - now.getTime()) / (60 * 60 * 1000);
      expect(noticeHours, `booked at ${hour}:30`).toBeGreaterThanOrEqual(48);
    }
  });

  it('refuses an unparseable date rather than letting it through', () => {
    expect(meetsLeadTime('not-a-date', FRIDAY_AFTERNOON)).toBe(false);
  });

  it('accepts a Date as well as a string', () => {
    expect(meetsLeadTime(d(2026, 9, 7), FRIDAY_AFTERNOON)).toBe(true);
  });

  it('honours an overridden lead time, so the rule can be tuned in one place', () => {
    // With no notice required, tomorrow is fine.
    expect(meetsLeadTime('2026-09-05', FRIDAY_AFTERNOON, 0)).toBe(true);
    // With a week required, it is not.
    expect(meetsLeadTime('2026-09-07', FRIDAY_AFTERNOON, 168)).toBe(false);
  });
});

describe('helpers', () => {
  it('startOfDay strips the time', () => {
    expect(startOfDay(FRIDAY_AFTERNOON)).toEqual(d(2026, 9, 4));
  });

  it('earliestStart is simply now plus the notice', () => {
    expect(earliestStart(FRIDAY_AFTERNOON).getTime())
      .toBe(FRIDAY_AFTERNOON.getTime() + 48 * 60 * 60 * 1000);
  });

  it('toDateInputValue formats for a date input, zero-padded', () => {
    expect(toDateInputValue(d(2026, 9, 7))).toBe('2026-09-07');
    expect(toDateInputValue(d(2026, 11, 25))).toBe('2026-11-25');
  });

  it('the message names the notice and the first date a customer can pick', () => {
    const msg = leadTimeMessage(FRIDAY_AFTERNOON);
    expect(msg).toContain('48 hours');
    expect(msg).toContain('7 September');
  });
});
