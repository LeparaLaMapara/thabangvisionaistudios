/**
 * Calendar dates as the person sees them, not as UTC.
 *
 * The booking widget used Date.toISOString().split('T')[0], which is the UTC
 * date. In Johannesburg (UTC+2) local midnight on 3 October is 22:00 on
 * 2 October UTC, so the day sent to the server was the day before the one
 * picked. These keep the local calendar date.
 */
export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "2026-10-03" to local midnight on that day; anything else to null. */
export function fromLocalYmd(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/**
 * The one date rule for a hire, shared by the gear page, the cart and the
 * checkout: the return day comes after the pick-up day, and the hire is
 * charged for the whole days in between (pick up 3 October, return
 * 4 October = 1 day). The same count as checkout's daysBetween on
 * YYYY-MM-DD dates.
 */
export function hireDays(start: Date, end: Date): number {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86_400_000);
}

export type HireRangeCheck =
  | { ok: true; days: number }
  | { ok: false; problem: 'incomplete' | 'same_day' | 'end_before_start' | 'too_long' | 'too_soon'; message: string };

/**
 * Whether a picked range is one the checkout will accept.
 *
 * `earliest` is the first day a hire may start (earliestBookableDate in
 * lib/rental/leadTime.ts, the rule the checkout enforces). Pass it wherever
 * dates can arrive from outside the picker: a link with ?start=&end=, an
 * older cart item, items put back after a cancelled payment. A start before
 * it (in the past, or without enough notice) is refused with a message that
 * names the first day that works. Availability is checked separately.
 */
export function checkHireRange(start: Date | null, end: Date | null, maxDays: number, earliest?: Date | null): HireRangeCheck {
  if (!start || !end) return { ok: false, problem: 'incomplete', message: 'Choose a pick-up day, then a return day.' };
  const days = hireDays(start, end);
  if (days === 0) {
    return { ok: false, problem: 'same_day', message: 'Choose a return day after the pick-up day. A one-day hire is returned the next day.' };
  }
  if (days < 0) return { ok: false, problem: 'end_before_start', message: 'The return day must come after the pick-up day.' };
  if (days > maxDays) return { ok: false, problem: 'too_long', message: `A hire can be at most ${maxDays} days. Choose an earlier return day.` };
  if (earliest && hireDays(earliest, start) < 0) {
    const first = earliest.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
    return {
      ok: false,
      problem: 'too_soon',
      message: `These dates are too soon or already past. Choose new dates: the earliest pick-up day is ${first}.`,
    };
  }
  return { ok: true, days };
}
