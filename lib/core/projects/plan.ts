/**
 * Ubunye plans (projects), the pure part. No Supabase, Next.js or AI SDK.
 *
 * A plan exists ONLY when coordination is needed: two or more parts, or a
 * need we cannot fill yet that must be remembered (a role that is coming
 * soon). One photographer never makes a plan. A plan holds REFERENCES only
 * (a gear order, a People request, a service booking) and needs; status,
 * price and dates are always read live from the referenced rows and turned
 * into plain words here (partView).
 *
 * Blind People rule: nothing here carries a person's name, user id, face or
 * contact. A People part is described by its role, dates and status only.
 */

import { PLAN_POLICY } from '@/lib/constants';
import { formatSaDay, isIsoDate } from '@/lib/dates/johannesburg';

export const PROJECT_REF_KINDS = ['gear_order', 'people_request', 'service_booking'] as const;
export type ProjectRefKind = (typeof PROJECT_REF_KINDS)[number];
export type ProjectItemKind = ProjectRefKind | 'need';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const isRefKind = (v: unknown): v is ProjectRefKind => typeof v === 'string' && (PROJECT_REF_KINDS as readonly string[]).includes(v);

/**
 * A part we have not booked: a person not asked yet, gear not booked yet, or
 * something we cannot fill (coming soon) or do not offer. The server decides
 * the status from the roles table, never the model.
 */
export interface PlanNeed {
  type: 'person' | 'gear' | 'unsupported';
  label: string;
  status: 'to_book' | 'coming_soon' | 'not_offered';
  role_slug?: string;
  /** A blind profile id find_people returned (person_roles.id), never a user id. */
  person_role_id?: string;
  rental_id?: string;
  /** For gear: the rental category (RENTAL_CATEGORIES slug), so the timeline knows its step. */
  category?: string;
}

/**
 * Where a part sits on the plan's timeline (098): the "do by" day for a part
 * not booked yet, the step in plain words, and the order. Planning data only.
 */
export interface PartTimeline {
  due_date?: string | null;
  step?: string | null;
  position?: number | null;
}

export type PlanPart =
  | ({ kind: ProjectRefKind; ref_id: string; label: string } & PartTimeline)
  | ({ kind: 'need'; need: PlanNeed } & PartTimeline);

/** What the client said, nothing more. */
export interface PlanBrief {
  outcome: string;
  place: string | null;
  date: string | null;
  date_label: string | null;
  date_end: string | null;
  budget_cents: number | null;
  /** The shoot type slug (lib/ubunye/shoot-types.ts), so the plan page can show the timeline. */
  shoot_type?: string | null;
}

/** The stored proposal payload (agent_actions.payload for kind project_create). */
export interface PlanPayload {
  title: string;
  brief: PlanBrief;
  parts: PlanPart[];
  source_conversation_id: string | null;
}

// ── Cleaning what the model or a browser sends ──────────────────────────────

/** One plain line: no tags, no control characters, no fences; trimmed to max. */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const t = raw
    .replace(/[\u0000-\u001f\u007f<>`]/g, ' ')
    .replace(/={3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

export function budgetCents(rands: unknown): number | null {
  const n = Number(rands);
  if (!Number.isFinite(n) || n <= 0 || n > PLAN_POLICY.maxBudgetRands) return null;
  return Math.round(n * 100);
}

/** Rands for people: "R15 000" (en-ZA groups with a no-break space, like the rest of the site). */
export function rands(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;
}

/** The brief, size-capped so it always fits projects.brief (097). */
export function makeBrief(p: { outcome: unknown; place?: unknown; date?: { iso: string; label: string } | null; dateEnd?: string | null; budget?: unknown; shootType?: string | null }): PlanBrief {
  const brief: PlanBrief = {
    outcome: cleanLine(p.outcome, PLAN_POLICY.maxOutcomeChars),
    place: cleanLine(p.place, PLAN_POLICY.maxPlaceChars) || null,
    date: p.date?.iso ?? null,
    date_label: p.date?.label ?? null,
    date_end: p.dateEnd && isIsoDate(p.dateEnd) && p.date && p.dateEnd >= p.date.iso ? p.dateEnd : null,
    budget_cents: budgetCents(p.budget),
    ...(p.shootType && /^[a-z0-9-]{2,40}$/.test(p.shootType) ? { shoot_type: p.shootType } : {}),
  };
  // Multi-byte text could pass the character caps and still be too big.
  while (new TextEncoder().encode(JSON.stringify(brief)).length > PLAN_POLICY.maxBriefBytes - 64 && brief.outcome.length > 20) {
    brief.outcome = brief.outcome.slice(0, Math.floor(brief.outcome.length * 0.8)).trim();
  }
  return brief;
}

/** "Music video · Soweto · Saturday 24 October 2026 · budget R15 000": the brief in one line. */
export function briefLine(b: Partial<PlanBrief> | null | undefined): string {
  if (!b) return '';
  const parts: string[] = [];
  if (b.outcome) parts.push(b.outcome);
  if (b.place) parts.push(b.place);
  if (b.date) parts.push(b.date_end && b.date_end !== b.date ? `${formatSaDay(b.date)} to ${formatSaDay(b.date_end)}` : formatSaDay(b.date));
  if (typeof b.budget_cents === 'number' && b.budget_cents > 0) parts.push(`budget ${rands(b.budget_cents)}`);
  return parts.join(' · ');
}

// ── When is a plan needed? ──────────────────────────────────────────────────

export type PlanNeeded =
  | { ok: true }
  | { ok: false; code: 'empty' | 'single' | 'nothing_we_offer' | 'too_many'; message: string };

/**
 * A plan only when coordination is needed. Parts we do not offer are listed
 * on a plan but never make one on their own.
 */
export function planNeeded(parts: readonly PlanPart[]): PlanNeeded {
  if (parts.length === 0) return { ok: false, code: 'empty', message: 'There is nothing to put in a plan yet.' };
  if (parts.length > PLAN_POLICY.maxParts) return { ok: false, code: 'too_many', message: `A plan holds at most ${PLAN_POLICY.maxParts} parts.` };
  const counted = parts.filter((p) => p.kind !== 'need' || p.need.status !== 'not_offered');
  if (counted.length === 0) {
    return { ok: false, code: 'nothing_we_offer', message: 'We do not offer any of these, so a plan cannot help. Say so plainly and do not make a plan.' };
  }
  if (counted.length >= 2) return { ok: true };
  const only = counted[0];
  if (only.kind === 'need' && only.need.status === 'coming_soon') return { ok: true };
  return {
    ok: false,
    code: 'single',
    message: 'No plan is needed for one thing. Book it on its own (for a person, the request link from find_people; for gear, the hire on its page or prepare_gear_booking).',
  };
}

/** One part per thing: the same reference or the same need only once. */
export function dedupeParts(parts: readonly PlanPart[]): PlanPart[] {
  const seen = new Set<string>();
  const out: PlanPart[] = [];
  for (const p of parts) {
    const key = p.kind === 'need'
      ? `need:${p.need.type}:${p.need.person_role_id ?? p.need.rental_id ?? p.need.role_slug ?? p.need.label.toLowerCase()}`
      : `${p.kind}:${p.ref_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** The words for one need on the approval card and the plan page. */
export function needWords(n: PlanNeed): string {
  if (n.status === 'not_offered') return `${n.label}: we do not offer this`;
  if (n.status === 'coming_soon') return `${n.label}: coming soon, we keep it on your plan`;
  if (n.type === 'person') return `${n.label}: not asked yet`;
  return `${n.label}: not booked yet`;
}

// ── The plan page: live state in plain words ───────────────────────────────

export interface NextAction {
  label: string;
  href: string;
}

export interface PartView {
  itemId: string;
  kind: ProjectItemKind;
  /** "Photographer or videographer: waiting for their reply". */
  line: string;
  /** For the dot next to it. */
  tone: 'done' | 'waiting' | 'todo' | 'blocked';
  next: NextAction | null;
  /** "Do by Saturday 31 October 2026", only for a part still to do (098). */
  due?: { iso: string; words: string; late: boolean } | null;
  /** The step in plain words, e.g. "Send requests for make-up". */
  step?: string | null;
  position?: number | null;
}

/** What the server read live for one item. Blind: no names, user ids or contacts. */
export type LivePart =
  | { kind: 'people_request'; itemId: string; found: false }
  | { kind: 'people_request'; itemId: string; found: true; requestId: string; roleName: string; roleSlug: string | null; status: string; dates: string[]; totalCents: number | null; personRoleId?: string; createdAt?: string }
  | { kind: 'gear_order'; itemId: string; found: false }
  | { kind: 'gear_order'; itemId: string; found: true; titles: string[]; statuses: string[]; startDate: string | null; endDate: string | null; amountCents: number | null; firstBookingId: string | null }
  | { kind: 'service_booking'; itemId: string; found: false }
  | { kind: 'service_booking'; itemId: string; found: true; category: string; status: string; paymentStatus: string; totalCents: number | null; shootDate: string | null }
  | { kind: 'need'; itemId: string; need: PlanNeed; roleStatus: 'live' | 'coming_soon' | 'gone' | null; roleName: string | null; rental: { title: string; href: string } | null };

const NOT_FOUND: Omit<PartView, 'itemId' | 'kind'> = { line: 'We cannot find this part any more', tone: 'blocked', next: null };

function withPlan(href: string, projectId: string, needItemId?: string): string {
  const [path, qs] = href.split('?');
  const q = new URLSearchParams(qs ?? '');
  q.set('plan', projectId);
  if (needItemId) q.set('need', needItemId);
  return `${path}?${q.toString()}`;
}

function peopleWords(status: string): { words: string; tone: PartView['tone'] } {
  switch (status) {
    case 'requested':
      return { words: 'waiting for their reply', tone: 'waiting' };
    case 'accepted':
      return { words: 'they can do it, pay to confirm', tone: 'todo' };
    case 'confirmed':
      return { words: 'booked, paid', tone: 'done' };
    case 'completed':
      return { words: 'done', tone: 'done' };
    case 'declined':
      return { words: 'they cannot do it, choose someone else', tone: 'todo' };
    case 'withdrawn':
      return { words: 'you cancelled this request', tone: 'blocked' };
    default:
      return { words: 'waiting for their reply', tone: 'waiting' };
  }
}

/** The order as a whole: the least finished line decides. */
function gearWords(statuses: readonly string[]): { words: string; tone: PartView['tone'] } {
  const has = (s: string) => statuses.includes(s);
  if (!statuses.length) return { words: 'we cannot find this order', tone: 'blocked' };
  if (statuses.every((s) => s === 'cancelled')) return { words: 'cancelled', tone: 'blocked' };
  if (statuses.every((s) => s === 'cancelled' || s === 'expired')) return { words: 'not paid in time, the hold ended', tone: 'blocked' };
  if (has('pending')) return { words: 'held, waiting for payment', tone: 'todo' };
  if (has('disputed')) return { words: 'under review with our team', tone: 'waiting' };
  if (has('overdue')) return { words: 'overdue, please bring it back', tone: 'todo' };
  if (has('active')) return { words: 'with you now', tone: 'waiting' };
  if (has('return_pending') || has('return_reviewed')) return { words: 'being checked after return', tone: 'waiting' };
  if (has('confirmed')) return { words: 'booked, paid', tone: 'done' };
  if (statuses.every((s) => s === 'completed' || s === 'cancelled')) return { words: 'done', tone: 'done' };
  return { words: 'in progress', tone: 'waiting' };
}

function serviceWords(status: string, paymentStatus: string): { words: string; tone: PartView['tone'] } {
  if (status === 'cancelled' || status === 'declined') return { words: 'cancelled', tone: 'blocked' };
  if (status === 'completed') return { words: 'done', tone: 'done' };
  if (paymentStatus !== 'paid') return { words: 'waiting for payment', tone: 'todo' };
  if (status === 'delivered') return { words: 'delivered, check and approve it', tone: 'todo' };
  return { words: 'booked, paid', tone: 'done' };
}

function datesLabel(dates: readonly string[]): string {
  const valid = dates.filter(isIsoDate);
  if (!valid.length) return '';
  return valid.length === 1 ? formatSaDay(valid[0]) : `${formatSaDay(valid[0])} to ${formatSaDay(valid[valid.length - 1])}`;
}

/** The "do by" words for a part still to do. Null when there is no due date or nothing to do. */
export function dueWords(dueIso: string | null | undefined, today: string): { iso: string; words: string; late: boolean } | null {
  if (!dueIso || !isIsoDate(dueIso)) return null;
  if (dueIso < today) return { iso: dueIso, words: `Do this now (it was due by ${formatSaDay(dueIso)})`, late: true };
  if (dueIso === today) return { iso: dueIso, words: 'Do this today', late: false };
  return { iso: dueIso, words: `Do by ${formatSaDay(dueIso)}`, late: false };
}

/** Parts in plan order: position, then the "do by" day, then as stored. Pure. */
export function orderParts<T extends { position?: number | null; due?: { iso: string } | null }>(views: readonly T[]): T[] {
  return views
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const pa = a.v.position ?? 1000;
      const pb = b.v.position ?? 1000;
      if (pa !== pb) return pa - pb;
      const da = a.v.due?.iso ?? '9999-12-31';
      const db = b.v.due?.iso ?? '9999-12-31';
      return da < db ? -1 : da > db ? 1 : a.i - b.i;
    })
    .map((x) => x.v);
}

export function partView(p: LivePart, projectId: string, brief: Partial<PlanBrief> | null = null, opts: { timeline?: PartTimeline; today?: string } = {}): PartView {
  const view = partViewBase(p, projectId, brief);
  const t = opts.timeline;
  if (!t) return view;
  return {
    ...view,
    step: t.step ?? null,
    position: typeof t.position === 'number' ? t.position : null,
    due: view.tone === 'todo' && opts.today ? dueWords(t.due_date ?? null, opts.today) : null,
  };
}

function partViewBase(p: LivePart, projectId: string, brief: Partial<PlanBrief> | null): PartView {
  const base = { itemId: p.itemId, kind: p.kind };
  if (p.kind !== 'need' && !p.found) return { ...base, ...NOT_FOUND };
  switch (p.kind) {
    case 'people_request': {
      if (!p.found) return { ...base, ...NOT_FOUND };
      const w = peopleWords(p.status);
      const when = datesLabel(p.dates);
      const next: NextAction | null =
        p.status === 'declined'
          ? { label: 'Choose someone else', href: withPlan(`/people${p.roleSlug ? `?role=${p.roleSlug}` : ''}`, projectId) }
          : p.status === 'withdrawn' || p.status === 'completed'
            ? null
            : { label: p.status === 'accepted' ? 'Pay to confirm' : p.status === 'confirmed' ? 'See who is coming' : 'See the request', href: `/people/requests/${p.requestId}` };
      return { ...base, line: `${p.roleName}${when ? ` (${when})` : ''}: ${w.words}`, tone: w.tone, next };
    }
    case 'gear_order': {
      if (!p.found) return { ...base, ...NOT_FOUND };
      const w = gearWords(p.statuses);
      const name = p.titles.length === 0 ? 'Gear' : p.titles.length === 1 ? p.titles[0] : `${p.titles[0]} and ${p.titles.length - 1} more`;
      return {
        ...base,
        line: `${name}: ${w.words}`,
        tone: w.tone,
        next: w.tone === 'blocked' || w.tone === 'done' ? null : { label: w.tone === 'todo' && p.statuses.includes('pending') ? 'Pay for it' : 'See the order', href: p.firstBookingId ? `/dashboard/bookings/${p.firstBookingId}` : '/dashboard/bookings' },
      };
    }
    case 'service_booking': {
      if (!p.found) return { ...base, ...NOT_FOUND };
      const w = serviceWords(p.status, p.paymentStatus);
      return { ...base, line: `${p.category}: ${w.words}`, tone: w.tone, next: w.tone === 'blocked' || w.tone === 'done' ? null : { label: 'See the booking', href: '/dashboard/bookings' } };
    }
    case 'need': {
      const n = p.need;
      if (n.type === 'person' && n.status === 'to_book') {
        // The role may have closed since the plan was made: say so, do not offer a dead link.
        if (p.roleStatus === 'coming_soon' || p.roleStatus === 'gone') {
          return { ...base, line: `${n.label}: not bookable right now, we keep it on your plan`, tone: 'blocked', next: null };
        }
        const q = new URLSearchParams();
        if (brief?.date) q.set('date', brief.date);
        if (brief?.place) q.set('area', brief.place);
        const href = n.person_role_id
          ? `/people/${n.person_role_id}/request${q.toString() ? `?${q.toString()}` : ''}`
          : `/people${n.role_slug ? `?role=${n.role_slug}` : ''}`;
        return { ...base, line: needWords(n), tone: 'todo', next: { label: n.person_role_id ? 'Request this person' : `Find a ${n.label.toLowerCase()}`, href: withPlan(href, projectId, p.itemId) } };
      }
      if (n.type === 'gear' && n.status === 'to_book') {
        const label = p.rental?.title ?? n.label;
        if (n.rental_id && !p.rental) return { ...base, line: `${n.label}: no longer listed, choose other gear`, tone: 'todo', next: { label: 'See gear', href: '/rentals' } };
        return { ...base, line: `${label}: not booked yet`, tone: 'todo', next: { label: p.rental ? 'See it' : 'See gear', href: p.rental?.href ?? '/rentals' } };
      }
      if (n.status === 'coming_soon' && p.roleStatus === 'live') {
        return { ...base, line: `${p.roleName ?? n.label}: now bookable`, tone: 'todo', next: { label: `Find a ${(p.roleName ?? n.label).toLowerCase()}`, href: withPlan(`/people${n.role_slug ? `?role=${n.role_slug}` : ''}`, projectId, p.itemId) } };
      }
      return { ...base, line: needWords(n), tone: 'blocked', next: null };
    }
  }
}

/** The one thing to do next on the plan: the first part with an action, open items first. */
export function planNextAction(views: readonly PartView[]): (NextAction & { line: string }) | null {
  const order: PartView['tone'][] = ['todo', 'waiting'];
  for (const tone of order) {
    const v = views.find((x) => x.tone === tone && x.next);
    if (v && v.next) return { ...v.next, line: v.line };
  }
  return null;
}

// ── Links that carry a plan (People request from the plan page or chat) ────

/** ?plan=<id>&need=<id> from a request link: both checked, both optional. Pure. */
export function parsePlanLink(params: Record<string, string | string[] | undefined>): { planId: string | null; needItemId: string | null } {
  const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';
  const planId = isUuid(one(params.plan)) ? one(params.plan) : null;
  const needItemId = planId && isUuid(one(params.need)) ? one(params.need) : null;
  return { planId, needItemId };
}
