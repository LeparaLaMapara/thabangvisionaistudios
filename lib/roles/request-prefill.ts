import { addDays, daysBetween, isIsoDate } from '@/lib/dates/johannesburg';

/**
 * Prefill for the People request form from its link
 * (/people/<id>/request?date=2026-10-18&days=2&area=Soweto&note=Graduation),
 * as Ubunye's "Request this person" card builds it. Pure.
 *
 * The link is typed by nobody we trust, so every value is checked and
 * dropped when it does not fit. It only fills the form; the person still
 * sees and sends it, and the price is always worked out on the server from
 * the profile (app/api/roles/requests), never from the link.
 */

export interface RequestPrefill {
  dates: string[];
  area: string | null;
  note: string | null;
}

export const PREFILL_MAX_DAYS = 14;
export const PREFILL_MAX_DAYS_AHEAD = 365;

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** One plain line: no tags, no control characters, trimmed to max. */
function cleanText(raw: string, max: number): string | null {
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return t || null;
}

export function parseRequestPrefill(params: Params, today: string, opts: { byDays: boolean }): RequestPrefill {
  const date = one(params.date).trim();
  let dates: string[] = [];
  if (isIsoDate(date) && date >= today && daysBetween(today, date) <= PREFILL_MAX_DAYS_AHEAD) {
    const asked = Number.parseInt(one(params.days), 10);
    const days = opts.byDays && Number.isFinite(asked) ? Math.max(1, Math.min(PREFILL_MAX_DAYS, asked)) : 1;
    dates = Array.from({ length: days }, (_, i) => addDays(date, i));
  }
  return {
    dates,
    area: cleanText(one(params.area), 80),
    note: cleanText(one(params.note), 200),
  };
}

/** The query string to carry through sign-in, rebuilt from the checked values only. */
export function prefillQuery(p: RequestPrefill): string {
  const q = new URLSearchParams();
  if (p.dates.length) q.set('date', p.dates[0]);
  if (p.dates.length > 1) q.set('days', String(p.dates.length));
  if (p.area) q.set('area', p.area);
  if (p.note) q.set('note', p.note);
  const s = q.toString();
  return s ? `?${s}` : '';
}
