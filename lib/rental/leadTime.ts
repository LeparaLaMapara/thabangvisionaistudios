import { ON_SITE_RENTAL, STUDIO } from '@/lib/constants';

/**
 * How much notice a hire needs before it starts.
 *
 * Gear could previously be booked for tomorrow, or for today: the only date
 * rules were "not in the past" and "no longer than 30 days". Stock has to be
 * checked, charged, cleaned and put aside, and none of that happens in an hour.
 *
 * The rule is 48 HOURS, not two calendar days, and that distinction does real
 * work. Bookings are date-granular — `start_date` is a date, not a timestamp —
 * so a naive "two days" check would accept a Sunday-morning hire booked on
 * Friday afternoon, which is about 44 hours and a scramble.
 *
 * So the comparison is made against the START of the booking day. Book at
 * 14:00 on Friday and Sunday 00:00 is 34 hours away and refused; Monday is 58
 * and accepted. The customer therefore gets between two and three days of
 * notice depending on the hour they book, and never less than 48. It errs
 * toward the shelf being ready, which is the direction that should be safe.
 */

/** Milliseconds in an hour. */
const HOUR_MS = 60 * 60 * 1000;

/** Start of the calendar day a date falls in, in the server's timezone. */
export function startOfDay(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The earliest instant a hire may begin.
 *
 * Exported so the date picker and the API can never disagree: both read this,
 * and both read the same constant.
 */
export function earliestStart(
  now: Date,
  leadHours: number = STUDIO.rental.minLeadTimeHours,
): Date {
  return new Date(now.getTime() + leadHours * HOUR_MS);
}

/**
 * The first calendar date that may be selected.
 *
 * The picker offers whole days, so it must offer the first day whose start is
 * already past the cutoff — not the day the cutoff lands in, which would let
 * someone choose a morning that has not cleared 48 hours.
 */
export function earliestBookableDate(
  now: Date,
  leadHours: number = STUDIO.rental.minLeadTimeHours,
): Date {
  const cutoff = earliestStart(now, leadHours);
  const candidate = startOfDay(cutoff);
  // If the cutoff falls part-way through that day, the day has already begun
  // too soon; the next one is the first that qualifies.
  if (candidate.getTime() < cutoff.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

/**
 * Whether a chosen start date gives enough notice.
 *
 * An unparseable date returns false: a date we cannot read is not a date we
 * should let through, and the surrounding validator reports the format problem
 * separately.
 */
export function meetsLeadTime(
  startDate: string | Date,
  now: Date,
  leadHours: number = STUDIO.rental.minLeadTimeHours,
): boolean {
  const parsed = startDate instanceof Date ? startDate : new Date(startDate);
  if (Number.isNaN(parsed.getTime())) return false;
  return startOfDay(parsed).getTime() >= earliestStart(now, leadHours).getTime();
}

/** Wording a customer can act on, naming the first date they can actually pick. */
export function leadTimeMessage(
  now: Date,
  leadHours: number = STUDIO.rental.minLeadTimeHours,
): string {
  const first = earliestBookableDate(now, leadHours);
  const formatted = first.toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  return `Equipment needs ${leadHours} hours' notice so it can be checked and prepared. `
    + `The earliest start date is ${formatted}.`;
}

/**
 * The same notice rule for a studio (checkout enforces one rule for every
 * hire), in studio words instead of "equipment ... checked and prepared".
 */
export function studioLeadTimeMessage(
  now: Date,
  leadHours: number = STUDIO.rental.minLeadTimeHours,
): string {
  const first = earliestBookableDate(now, leadHours);
  const formatted = first.toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  return ON_SITE_RENTAL.leadTimeMessage(leadHours, formatted);
}

/** `YYYY-MM-DD`, for the `min` attribute of a date input. */
export function toDateInputValue(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
