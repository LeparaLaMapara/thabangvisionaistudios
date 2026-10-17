import { ROLES_POLICY } from '@/lib/constants';
import { workingDaysAfter } from '@/lib/dates/johannesburg';
import type { RequestInput } from '@/lib/supabase/queries/roles';
import { bookingTotal, effectiveUnit, pricedByDays } from './pricing';
import { isDuplicateRequestError } from './request-guards';
import type { PricingUnit } from './types';

/**
 * Sending one People request: the ONE set of rules, used by the request form
 * (POST /api/roles/requests) and by "Ask everyone" from Ubunye (approval kind
 * people_requests, lib/projects/requests.ts). Storage is a port, so the rules
 * are unit-tested with fakes; lib/roles/request-send-server.ts wires Supabase.
 *
 * The caller has already checked: roles_v1 is on and the person asking is
 * signed in (and, for the form, the rate limit). Here, in order:
 *   1. the request itself: one or more days (YYYY-MM-DD, unique, sorted, at
 *      most 14), an arrival time, hours (0.5 to 24) and the area;
 *   2. the first day is not before South African today;
 *   3. the person is listed (an approved profile) and, when asked
 *      (liveRoleOnly), their role is live;
 *   4. nobody books themselves;
 *   5. the duplicate guard: the same client, person and first day while a
 *      request is still open returns that request (a double submit);
 *   6. the price is worked out here from the profile, never from the caller;
 *   7. the double-booking guard at insert: if two sends race past step 5,
 *      the 096 unique index refuses the second, which gets the first back.
 * Short notice is reported, never refused: a request for a day before the
 * person's reply is due may not be confirmed in time (find_people says the
 * same). Database errors throw; the caller turns them into a plain refusal.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
export const REQUEST_MAX_DAYS = 14;

/** What the rules need from a profile (getPublicRoleProfile returns more). */
export interface RequestProfile {
  personRole: { id: string; price_cents: number | null; pricing_unit?: PricingUnit | null };
  role: { pricing_unit: PricingUnit; suggested_price_cents: { typical: number }; status?: string };
}

export interface SendRequestDeps {
  /** An approved, blind profile. Null when not listed. */
  profile(personRoleId: string): Promise<RequestProfile | null>;
  /** The asking client's own profiles (nobody books themselves). */
  ownRoles(): Promise<{ id: string }[]>;
  /** The client's open request to this person for this first day (096). */
  findOpen(clientId: string, personRoleId: string, firstDate: string): Promise<string | null>;
  create(input: RequestInput): Promise<string>;
  /** South African today, YYYY-MM-DD. */
  today(): string;
}

export type SendRequestRefusal = {
  kind: 'refused';
  status: 400 | 404 | 409;
  code: 'bad_request' | 'past_date' | 'not_listed' | 'not_live' | 'own_profile';
  message: string;
};

export type SendRequestOutcome =
  | { kind: 'created'; id: string; firstDate: string; shortNotice: boolean; replyBy: string }
  /** raced: the 096 index refused a second insert (step 7), not the check at step 5. */
  | { kind: 'existing'; id: string; raced: boolean }
  | SendRequestRefusal;

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && !/[<>]/.test(v) ? v.trim().slice(0, max) : null);

/** Whether the first day comes on or before the day the person's answer is due (lib/agents/tools/people.ts peopleShortNotice). */
export function requestShortNotice(firstDate: string, today: string): { short: boolean; replyBy: string } {
  const replyBy = workingDaysAfter(today, ROLES_POLICY.requests.replyWithinWorkingDays);
  return { short: firstDate <= replyBy, replyBy };
}

/**
 * Send one request for a signed-in client. `body` is what the form posts:
 * { person_role_id, dates | date, arrival, hours, area, address?, note? }.
 */
export async function sendPeopleRequest(
  clientId: string,
  body: Record<string, unknown>,
  deps: SendRequestDeps,
  opts: { liveRoleOnly?: boolean } = {},
): Promise<SendRequestOutcome> {
  const id = typeof body.person_role_id === 'string' ? body.person_role_id : '';
  // Days (like Rentals) or one date; sorted, unique, from today on.
  const rawDates = Array.isArray(body.dates) ? body.dates : typeof body.date === 'string' ? [body.date] : [];
  const dates = [...new Set(rawDates.filter((d): d is string => typeof d === 'string' && DATE.test(d)))].sort().slice(0, REQUEST_MAX_DAYS);
  const date = dates[0] ?? null;
  const arrival = typeof body.arrival === 'string' && TIME.test(body.arrival) ? body.arrival : null;
  const hours = Number(body.hours);
  const area = text(body.area, 80);
  if (!date || !arrival || !area || !Number.isFinite(hours) || hours < 0.5 || hours > 24) {
    return { kind: 'refused', status: 400, code: 'bad_request', message: 'Add the date, the arrival time, how long, and the area.' };
  }
  // "Today" is South African today: in UTC, 00:00 to 02:00 would still allow yesterday.
  const today = deps.today();
  if (date < today) return { kind: 'refused', status: 400, code: 'past_date', message: 'Pick dates from today on.' };

  const profile = await deps.profile(id);
  if (!profile) return { kind: 'refused', status: 404, code: 'not_listed', message: 'That profile is not available.' };
  if (opts.liveRoleOnly && profile.role.status !== 'live') {
    return { kind: 'refused', status: 404, code: 'not_live', message: 'That kind of person cannot be booked right now.' };
  }
  // Nobody books themselves (a self-booking would grow their own record).
  if ((await deps.ownRoles()).some((r) => r.id === profile.personRole.id)) {
    return { kind: 'refused', status: 409, code: 'own_profile', message: 'That is your own profile.' };
  }
  // Already asked (a double submit, or a second tab): the same request back.
  const existing = await deps.findOpen(clientId, profile.personRole.id, date);
  if (existing) return { kind: 'existing', id: existing, raced: false };

  // The one price, worked out here from the profile, never from the browser.
  const unit = effectiveUnit(profile.role.pricing_unit, profile.personRole.pricing_unit);
  const price = profile.personRole.price_cents ?? profile.role.suggested_price_cents.typical;
  const total = bookingTotal(unit, price, { days: pricedByDays(unit) ? dates.length : 1, hours });
  let requestId: string;
  try {
    requestId = await deps.create({
      personRoleId: profile.personRole.id,
      clientId,
      date,
      arrival,
      hours: Math.round(hours * 2) / 2,
      area,
      address: text(body.address, 200),
      note: text(body.note, 500),
      dates: pricedByDays(unit) ? dates : [date],
      unit,
      totalCents: total.totalCents,
    });
  } catch (err) {
    // Two sends raced past the check above: 096 kept one; return it.
    if (!isDuplicateRequestError(err)) throw err;
    const raced = await deps.findOpen(clientId, profile.personRole.id, date);
    if (!raced) throw err;
    return { kind: 'existing', id: raced, raced: true };
  }
  const notice = requestShortNotice(date, today);
  return { kind: 'created', id: requestId, firstDate: date, shortNotice: notice.short, replyBy: notice.replyBy };
}
