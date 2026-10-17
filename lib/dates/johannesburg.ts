/**
 * Dates in South African time, and plain words to a date. Pure.
 *
 * Ubunye used to have no idea what day it was, so "tomorrow" was a guess.
 * The server's clock is the one authority: today's date, weekday and time in
 * Africa/Johannesburg go into every prompt, and the tools turn words like
 * "tomorrow", "next weekend", "Friday" or "24 April 2027" into one ISO date
 * with the rule they used, so the model and the tools always agree and the
 * customer can correct a reading they did not mean.
 *
 * Calendar dates are handled as "YYYY-MM-DD" strings and UTC-midnight Date
 * objects, so the server's own timezone never moves a day.
 */

export const SA_TIME_ZONE = 'Africa/Johannesburg';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

export interface SaNow {
  /** Today in Johannesburg, "2026-10-17". */
  iso: string;
  /** "Saturday". */
  weekday: string;
  /** "14:05", 24-hour. */
  time: string;
}

/** Today's date, weekday and time in Johannesburg, from the given clock. */
export function saNow(now: Date = new Date()): SaNow {
  const iso = now.toLocaleDateString('en-CA', { timeZone: SA_TIME_ZONE });
  const time = now.toLocaleTimeString('en-GB', { timeZone: SA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
  return { iso, weekday: WEEKDAYS[weekdayIndex(iso)], time };
}

/** Today in Johannesburg, "YYYY-MM-DD". */
export function saToday(now: Date = new Date()): string {
  return saNow(now).iso;
}

/** A real calendar date in "YYYY-MM-DD" form (no 2027-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function toUtc(iso: string): Date {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The date n days after (or before, n < 0) an ISO date. */
export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayIndex(iso: string): number {
  return toUtc(iso).getUTCDay();
}

/** "Sunday 18 October 2026". */
export function formatSaDay(iso: string): string {
  const d = toUtc(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getUTCFullYear()}`;
}

/**
 * The date n working days (Monday to Friday) after an ISO date. Public
 * holidays are not counted out: the reply promise is stated in working days
 * and this is the earliest it can fall.
 */
export function workingDaysAfter(iso: string, n: number): string {
  let d = iso;
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    d = addDays(d, 1);
    const w = weekdayIndex(d);
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d;
}

/** One line for the system prompt, from the server clock. */
export function clockLine(now: Date = new Date()): string {
  const t = saNow(now);
  return `Today is ${formatSaDay(t.iso)} (${t.iso}), and the time is ${t.time} in South Africa (${SA_TIME_ZONE}). This comes from our server clock: use it to work out "today", "tomorrow", "this weekend" and weekday names, and never guess the date or the year.`;
}

// ─── Words to a date ─────────────────────────────────────────────────────────

export interface ResolvedDate {
  /** "2026-10-18". */
  iso: string;
  /** "Sunday 18 October 2026". */
  label: string;
  /** How the words were read, to say back so the customer can correct it. */
  rule: string;
}

const DAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function monthIndex(word: string): number {
  const w = word.toLowerCase();
  if (w.length < 3) return -1;
  return MONTHS.findIndex((m) => m.startsWith(w) || (w === 'sept' && m === 'september'));
}

function made(iso: string, rule: string): ResolvedDate {
  return { iso, label: formatSaDay(iso), rule };
}

/** A day and month with no year: the next time it comes round, today included. */
function nextDayMonth(day: number, month: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const iso = `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isIsoDate(iso) && iso >= today) return iso;
  }
  return null;
}

function dayMonthYear(day: number, month: number, year: number | null, today: string, said: string): ResolvedDate | null {
  if (month < 0 || day < 1 || day > 31) return null;
  if (year !== null) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isIsoDate(iso) ? made(iso, `"${said}" read as ${formatSaDay(iso)}`) : null;
  }
  const iso = nextDayMonth(day, month, today);
  return iso ? made(iso, `"${said}" read as ${formatSaDay(iso)} (no year given, so the next one)`) : null;
}

/**
 * Plain words to one date, in Johannesburg time. Null when there is no
 * single day in the words (for example "next week" or "soon").
 *
 *   today, tonight, tomorrow, the day after tomorrow, in 3 days
 *   this weekend (the coming Saturday; today on a weekend), next weekend
 *   Friday (the next Friday after today), this Friday (today if it is
 *   Friday), next Friday (Friday of next week)
 *   24 April 2027, 24 Apr, April 24th 2027, 2027-04-24, 24/04/2027
 */
export function resolveDate(text: string, now: Date = new Date()): ResolvedDate | null {
  if (typeof text !== 'string') return null;
  const said = text.trim().slice(0, 80);
  const t = said.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');
  if (!t) return null;
  const today = saToday(now);
  const todayW = weekdayIndex(today);

  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso) return isIsoDate(iso[1]) ? made(iso[1], `${formatSaDay(iso[1])} as given`) : null;

  // South African order: day/month/year.
  const num = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(t);
  if (num) return dayMonthYear(Number(num[1]), Number(num[2]) - 1, Number(num[3]), today, said);

  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]{3,9})(?: (\d{4}))?\b/.exec(t);
  if (dm && monthIndex(dm[2]) >= 0) return dayMonthYear(Number(dm[1]), monthIndex(dm[2]), dm[3] ? Number(dm[3]) : null, today, said);
  const md = /\b([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?\b/.exec(t);
  if (md && monthIndex(md[1]) >= 0) return dayMonthYear(Number(md[2]), monthIndex(md[1]), md[3] ? Number(md[3]) : null, today, said);

  if (/\b(the )?day after tomorrow\b/.test(t)) return made(addDays(today, 2), 'the day after tomorrow');
  if (/\btomorrow\b/.test(t)) return made(addDays(today, 1), 'tomorrow');
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) return made(today, 'today');

  const inDays = /\bin (\d{1,3}) days?\b/.exec(t);
  if (inDays && Number(inDays[1]) >= 1 && Number(inDays[1]) <= 365) return made(addDays(today, Number(inDays[1])), `in ${inDays[1]} days`);

  // The coming Saturday, or today when today is already the weekend.
  const thisSaturday = todayW === 6 || todayW === 0 ? today : addDays(today, 6 - todayW);
  if (/\bnext weekend\b/.test(t)) {
    const sat = todayW === 0 ? addDays(today, 6) : addDays(thisSaturday, 7);
    return made(sat, 'next weekend, read as the Saturday of the weekend after this one');
  }
  if (/\b(this )?weekend\b/.test(t)) {
    return made(thisSaturday, todayW === 0 ? 'this weekend, read as today (Sunday)' : todayW === 6 ? 'this weekend, read as today (Saturday)' : 'this weekend, read as the coming Saturday');
  }

  const wd = /\b(?:(this|next|coming|on) )?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/.exec(t);
  if (wd) {
    const target = DAY_WORDS[wd[2]];
    const ahead = (target - todayW + 7) % 7;
    if (wd[1] === 'this' && ahead === 0) return made(today, `this ${WEEKDAYS[target]}, read as today`);
    const next = addDays(today, ahead === 0 ? 7 : ahead);
    if (wd[1] === 'next') {
      // "Next Friday" is Friday of next week (Monday to Sunday weeks).
      const daysToSunday = (7 - todayW) % 7;
      const inThisWeek = daysBetween(today, next) <= daysToSunday;
      const iso2 = inThisWeek ? addDays(next, 7) : next;
      return made(iso2, `next ${WEEKDAYS[target]}, read as ${WEEKDAYS[target]} of next week`);
    }
    return made(next, `${WEEKDAYS[target]}, read as the next ${WEEKDAYS[target]}`);
  }
  return null;
}
