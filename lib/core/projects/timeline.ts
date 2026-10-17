/**
 * The plan timeline (098), the pure part. A shoot type (lib/ubunye/shoot-types.ts)
 * says how many days before the shoot each part is usually booked; here that
 * becomes a real "do by" date, a step in plain words and an order for every
 * part we have not booked yet. Parts already booked keep no due date: their
 * own dates live on the booking.
 */

import { RENTAL_CATEGORY_VALUES, SHOOT_PLAN_POLICY } from '@/lib/constants';
import { addDays, formatSaDay, isIsoDate } from '@/lib/dates/johannesburg';
import { partLeadDays, shootTypeBySlug, type ShootPart, type ShootType } from '@/lib/ubunye/shoot-types';
import type { PlanBrief, PlanPart } from './plan';

/** The timeline key and kind of a part: role slug, gear category or "studios". Null when it has none. */
export function timelineKey(part: PlanPart): { key: string; kind: ShootPart['kind'] } | null {
  if (part.kind !== 'need') return null;
  const n = part.need;
  if (n.status === 'not_offered') return null;
  if (n.type === 'gear') {
    if (!n.category || !(RENTAL_CATEGORY_VALUES as readonly string[]).includes(n.category)) return null;
    return { key: n.category, kind: n.category === 'studios' ? 'studio' : 'gear' };
  }
  return n.role_slug ? { key: n.role_slug, kind: 'person' } : null;
}

function defaultStep(kind: ShootPart['kind'], label: string): string {
  return kind === 'person' ? `Send a request: ${label}`.slice(0, 120) : `Book it: ${label}`.slice(0, 120);
}

/**
 * Every part gets a position; parts not booked yet also get a "do by" date
 * and a step, from the type's timeline (or the defaults) counted back from
 * the shoot date. Without a date or a type, only positions (as given).
 */
export function assignTimeline(type: ShootType | null, shootIso: string | null, parts: readonly PlanPart[]): PlanPart[] {
  const placed = parts.map((part, index) => {
    const tk = type && shootIso && isIsoDate(shootIso) ? timelineKey(part) : null;
    if (!tk || !type || !shootIso) return { part: { ...part }, at: Number.POSITIVE_INFINITY, index };
    const at = partLeadDays(type, tk.key, tk.kind);
    const step = type.timeline.find((s) => s.part === tk.key && s.at < 0)?.label ?? defaultStep(tk.kind, part.kind === 'need' ? part.need.label : '');
    return { part: { ...part, due_date: addDays(shootIso, at), step }, at, index };
  });
  // Earliest "do by" first; parts with no date keep the order they were given in, after.
  const order = [...placed].sort((a, b) => a.at - b.at || a.index - b.index);
  const positionOf = new Map(order.map((p, i) => [p.index, Math.min(i, 100)]));
  return placed.map((p) => ({ ...p.part, position: positionOf.get(p.index) ?? 100 }));
}

export interface PlanStep {
  iso: string;
  label: string;
  /** "Saturday 31 October 2026" */
  when: string;
  past: boolean;
}

/**
 * The plan's own steps that are not a part to book (the shoot day, the edit
 * afterwards, "test the internet at the venue"), with real dates from the
 * brief. Empty without a known type or date.
 */
export function planSteps(brief: Partial<PlanBrief> | null | undefined, today: string): PlanStep[] {
  const type = shootTypeBySlug(brief?.shoot_type);
  const start = brief?.date && isIsoDate(brief.date) ? brief.date : null;
  if (!type || !start) return [];
  const end = brief?.date_end && isIsoDate(brief.date_end) && brief.date_end >= start ? brief.date_end : start;
  return type.timeline
    .filter((s) => !s.part || s.at >= 0)
    .map((s) => {
      const iso = addDays(s.at > 0 ? end : start, s.at);
      return { iso, label: s.label, when: formatSaDay(iso), past: iso < today };
    })
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

/** Days a plan moves by, or null when it cannot be worked out (no old date) or is out of range. */
export function moveShift(oldIso: string | null | undefined, newIso: string): number | null {
  if (!oldIso || !isIsoDate(oldIso) || !isIsoDate(newIso)) return null;
  const shift = Math.round((Date.UTC(+newIso.slice(0, 4), +newIso.slice(5, 7) - 1, +newIso.slice(8, 10)) - Date.UTC(+oldIso.slice(0, 4), +oldIso.slice(5, 7) - 1, +oldIso.slice(8, 10))) / 86_400_000);
  return Math.abs(shift) > SHOOT_PLAN_POLICY.maxMoveDays ? null : shift;
}
