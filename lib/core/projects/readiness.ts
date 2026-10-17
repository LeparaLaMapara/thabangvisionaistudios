/**
 * "N of M ready" on a plan, and "Ask the next listed person". Pure.
 *
 * The client watches the plan fill as people say yes. Only people and gear
 * count: a People request, a service booking, gear, and person or gear needs
 * still to book. Needs we cannot fill (coming soon, not offered) never count.
 *
 *   ready: a person accepted or confirmed (or the job is done), a service
 *          booking is paid, gear is booked (paid, out, back or done);
 *   not ready: everything else that counts (waiting, held, not asked yet,
 *          declined, no answer in time);
 *   left out: what the client cancelled (a withdrawn request, a cancelled
 *          booking or order) and parts we cannot find.
 *
 * A declined request, or one with no answer in time (still "requested" after
 * the reply window, or its day passed), is a place still to fill. When the
 * client asks someone else for that role, the newer request takes its place
 * (one for one, oldest first), so asking down the list never makes M grow.
 * A place still to fill gets "Ask the next listed person": a link to People
 * for that role and day, carrying the plan (and its open need for that
 * role). Nothing is sent by the link: the client picks and sends.
 *
 * Blind: role, days and status only. No names, no user ids.
 */

import { ROLES_POLICY } from '@/lib/constants';
import { saToday, workingDaysAfter } from '@/lib/dates/johannesburg';
import { parseRequestPrefill, prefillQuery } from '@/lib/roles/request-prefill';
import type { LivePart, PlanBrief } from './plan';

export interface PlanReadiness {
  ready: number;
  total: number;
  /** item id -> the "Ask the next listed person" link, for places still to fill. */
  askNext: Record<string, string>;
}

type PeoplePart = Extract<LivePart, { kind: 'people_request'; found: true }>;

const READY_PEOPLE = ['accepted', 'confirmed', 'completed'];
const GEAR_BOOKED = ['confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'completed', 'disputed'];

/** No answer in time: still "requested" after the reply window, or its first day has passed. */
export function requestExpired(p: Pick<PeoplePart, 'status' | 'dates' | 'createdAt'>, today: string): boolean {
  if (p.status !== 'requested') return false;
  const first = [...p.dates].sort()[0];
  if (first && first < today) return true;
  if (!p.createdAt) return false;
  const sent = new Date(p.createdAt);
  if (Number.isNaN(sent.getTime())) return false;
  return today > workingDaysAfter(saToday(sent), ROLES_POLICY.requests.replyWithinWorkingDays);
}

/** People for this role and day, prefilled (checked by request-prefill), carrying the plan and need. */
export function askNextHref(p: { roleSlug: string | null; dates: readonly string[]; projectId: string; needItemId: string | null; brief: Partial<PlanBrief> | null; today: string }): string {
  const days = [...p.dates].sort();
  const pre = parseRequestPrefill(
    { date: days[0], days: days.length > 1 ? String(days.length) : undefined, area: p.brief?.place ?? undefined, note: p.brief?.outcome ?? undefined },
    p.today,
    { byDays: true },
  );
  const q = new URLSearchParams(prefillQuery(pre).replace(/^\?/, ''));
  if (p.roleSlug && /^[a-z0-9-]{2,40}$/.test(p.roleSlug)) q.set('role', p.roleSlug);
  q.set('plan', p.projectId);
  if (p.needItemId) q.set('need', p.needItemId);
  return `/people?${q.toString()}`;
}

export function planReadiness(live: readonly LivePart[], opts: { projectId: string; brief: Partial<PlanBrief> | null; today: string; open: boolean }): PlanReadiness {
  let ready = 0;
  let total = 0;
  const askNext: Record<string, string> = {};
  const byRole = new Map<string, PeoplePart[]>();
  const openNeeds = new Map<string, string>();

  for (const p of live) {
    if (p.kind === 'need') {
      const n = p.need;
      const personToBook = n.type === 'person' && n.status === 'to_book' && p.roleStatus !== 'coming_soon' && p.roleStatus !== 'gone';
      const nowBookable = n.type !== 'gear' && n.status === 'coming_soon' && p.roleStatus === 'live';
      const gearToBook = n.type === 'gear' && n.status === 'to_book';
      if (personToBook || nowBookable || gearToBook) total += 1;
      if (personToBook && n.role_slug && !openNeeds.has(n.role_slug)) openNeeds.set(n.role_slug, p.itemId);
      continue;
    }
    if (!p.found) continue;
    if (p.kind === 'gear_order') {
      if (!p.statuses.length || p.statuses.every((s) => s === 'cancelled')) continue;
      total += 1;
      if (!p.statuses.includes('pending') && p.statuses.some((s) => GEAR_BOOKED.includes(s))) ready += 1;
      continue;
    }
    if (p.kind === 'service_booking') {
      if (p.status === 'cancelled' || p.status === 'declined') continue;
      total += 1;
      if (p.paymentStatus === 'paid' || p.status === 'completed') ready += 1;
      continue;
    }
    if (p.status === 'withdrawn') continue;
    const key = p.roleSlug ?? p.roleName;
    byRole.set(key, [...(byRole.get(key) ?? []), p]);
  }

  for (const requests of byRole.values()) {
    // Oldest first; a request with no time keeps its place.
    const ordered = requests.map((r, i) => ({ r, i })).sort((a, b) => (a.r.createdAt ?? '').localeCompare(b.r.createdAt ?? '') || a.i - b.i).map((x) => x.r);
    const toFill: PeoplePart[] = [];
    for (const r of ordered) {
      // A newer request takes the place of an older one that fell through.
      if (toFill.length) toFill.shift();
      if (r.status === 'declined' || requestExpired(r, opts.today)) {
        toFill.push(r);
        continue;
      }
      total += 1;
      if (READY_PEOPLE.includes(r.status)) ready += 1;
    }
    for (const r of toFill) {
      total += 1;
      if (opts.open) {
        askNext[r.itemId] = askNextHref({ roleSlug: r.roleSlug, dates: r.dates, projectId: opts.projectId, needItemId: r.roleSlug ? openNeeds.get(r.roleSlug) ?? null : null, brief: opts.brief, today: opts.today });
      }
    }
  }
  return { ready, total, askNext };
}

/** "2 of 5 ready". Null when nothing on the plan counts. */
export function readinessWords(r: Pick<PlanReadiness, 'ready' | 'total'>): string | null {
  return r.total > 0 ? `${r.ready} of ${r.total} ready` : null;
}
