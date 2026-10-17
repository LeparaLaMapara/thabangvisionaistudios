/**
 * "Ask everyone" (approval kind people_requests), the deterministic part.
 *
 * The client sees their whole shoot and taps once to ask every chosen person.
 * The model only PROPOSES (propose_requests); this code decides everything
 * that matters, from our own data:
 *
 *  - every person id must be one a tool returned in this conversation
 *    (seenIds, plus ids stored with earlier messages), then is checked again:
 *    an approved profile whose role is live. The role comes from that
 *    profile, never from the model's words;
 *  - the plan, when there is one, must be the client's own and open; the
 *    need a request fills must be a person need of that plan, in that role;
 *  - at most PLAN_POLICY.maxAskAtOnce requests, one per person;
 *  - it costs nothing (amount 0): a request is not a booking and nothing is
 *    paid until a person says yes and the client pays (a later stage).
 *
 * Nothing is sent until the client presses Approve. The commit then sends
 * each request through the SAME rules as the request form
 * (lib/roles/request-send.ts), one by one, and reports each honestly:
 * created, already open (the request that is still open) or refused (why,
 * in plain words). Partial success is reported as partial.
 *
 * Blind People rule: no names anywhere here. A request is described by its
 * role, day(s) and place only.
 */

import { PLAN_POLICY, ROLES_POLICY } from '@/lib/constants';
import { addDays, daysBetween, formatSaDay, isIsoDate, saToday, type ResolvedDate } from '@/lib/dates/johannesburg';
import { pricedByDays } from '@/lib/roles/pricing';
import type { PricingUnit } from '@/lib/roles/types';
import type { ApprovalSummary } from '@/lib/core/agent/use-cases';
import { REQUEST_MAX_DAYS, type SendRequestOutcome } from '@/lib/roles/request-send';
import { cleanLine, isUuid } from './plan';
import type { Refusal } from './use-cases';

/** How far ahead a request can be sent (the request link and find_people use the same). */
export const ASK_MAX_DAYS_AHEAD = 365;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface AskRequest {
  /** A blind profile id (person_roles.id) find_people returned. */
  person_role_id: string;
  /** From the profile, never from the model. */
  role_slug: string;
  /** The plan's person need this request fills, if any. */
  need_item_id: string | null;
  /** Hours (a day, for people paid by the day). */
  hours: number;
}

/** The stored proposal payload (agent_actions.payload for kind people_requests). */
export interface PeopleRequestsPayload {
  project_id: string | null;
  date: string;
  date_end: string | null;
  place: string;
  brief: string;
  arrival: string;
  requests: AskRequest[];
}

/** A listed person, blind: the role and how they are paid. */
export interface AskPerson {
  id: string;
  roleSlug: string;
  roleName: string;
  roleLive: boolean;
  unit: PricingUnit;
}

/** The client's plan: open or not, its title, and its person needs not asked yet. */
export interface AskPlan {
  id: string;
  title: string;
  open: boolean;
  needs: { itemId: string; roleSlug: string }[];
}

export interface AskLookups {
  /** ubunye_projects and roles_v1 both on. */
  flagsOn(): Promise<boolean>;
  /** An approved profile. Null when not listed. */
  person(id: string): Promise<AskPerson | null>;
  /** The client's own plan. Null when it is not theirs or does not exist. */
  plan(clientId: string, projectId: string): Promise<AskPlan | null>;
  /** The client's open plan from this chat, when no plan is named. */
  chatPlan?(clientId: string): Promise<AskPlan | null>;
  /** Ids our tools returned in earlier turns of this conversation. */
  priorIds(): Promise<Set<string>>;
  resolveDate(text: string, now: Date): ResolvedDate | null;
  now(): Date;
}

export interface ProposeRequestsInput {
  project_id?: unknown;
  date?: unknown;
  date_end?: unknown;
  place?: unknown;
  brief?: unknown;
  arrival?: unknown;
  hours?: unknown;
  requests?: unknown;
}

export const ASK_OFF: Refusal = { ok: false, code: 'off', message: 'Asking people from the chat is not available right now.' };
const CHECK_FAILED: Refusal = { ok: false, code: 'check_failed', message: 'We could not check that just now, so nothing was sent. Try again in a moment.' };
const UNKNOWN_ID: Refusal = {
  ok: false,
  code: 'unknown_id',
  message: 'Use only people find_people returned in this chat. Search again with find_people, then ask them.',
};

const REPLY_DAYS = ROLES_POLICY.requests.replyWithinWorkingDays;
const replyWithin = `${REPLY_DAYS} working day${REPLY_DAYS === 1 ? '' : 's'}`;

/** The days one request asks for: every day for people paid by the day, the first day otherwise. */
export function askDays(p: Pick<PeopleRequestsPayload, 'date' | 'date_end'>, unit: PricingUnit | null): string[] {
  const end = p.date_end && isIsoDate(p.date_end) && p.date_end > p.date ? p.date_end : null;
  if (!end || (unit && !pricedByDays(unit))) return [p.date];
  const n = Math.min(REQUEST_MAX_DAYS, daysBetween(p.date, end) + 1);
  return Array.from({ length: n }, (_, i) => addDays(p.date, i));
}

function daysWords(days: readonly string[]): string {
  return days.length > 1 ? `${formatSaDay(days[0])} to ${formatSaDay(days[days.length - 1])}` : formatSaDay(days[0]);
}

function hoursWords(hours: number, unit: PricingUnit): string {
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return pricedByDays(unit) ? `${h} a day` : h;
}

function readDate(raw: unknown, now: Date, lookups: Pick<AskLookups, 'resolveDate'>): { ok: true; iso: string | null } | Refusal {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: true, iso: null };
  const t = raw.trim();
  const today = saToday(now);
  const iso = isIsoDate(t) ? t : lookups.resolveDate(t, now)?.iso ?? null;
  if (!iso) return { ok: false, code: 'bad_date', message: `I could not read "${cleanLine(t, 40)}" as a date. Today is ${formatSaDay(today)}. Ask which day they mean.` };
  if (iso < today) return { ok: false, code: 'bad_date', message: `${formatSaDay(iso)} has passed. Today is ${formatSaDay(today)}. Ask which day they mean.` };
  if (daysBetween(today, iso) > ASK_MAX_DAYS_AHEAD) return { ok: false, code: 'bad_date', message: 'People can be asked up to a year ahead.' };
  return { ok: true, iso };
}

/** Hours from the client, or the request form's own starting value for how this person is paid. */
function hoursFor(raw: unknown, unit: PricingUnit): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0.5 && n <= 24) return Math.round(n * 2) / 2;
  return pricedByDays(unit) ? PLAN_POLICY.askDefaults.hoursByDay : PLAN_POLICY.askDefaults.hoursByHour;
}

/** The plan a request batch joins: the one named (theirs, open), else the open plan from this chat, else none. */
async function pickPlan(clientId: string, raw: unknown, lookups: AskLookups): Promise<{ ok: true; plan: AskPlan | null } | Refusal> {
  if (raw !== undefined && raw !== null && raw !== '') {
    if (!isUuid(raw)) return { ok: false, code: 'not_found', message: 'That plan does not exist.' };
    const plan = await lookups.plan(clientId, raw);
    if (!plan) return { ok: false, code: 'not_found', message: 'That plan does not exist.' };
    if (!plan.open) return { ok: false, code: 'closed', message: 'That plan is closed, so nobody can be asked from it.' };
    return { ok: true, plan };
  }
  const fromChat = lookups.chatPlan ? await lookups.chatPlan(clientId) : null;
  return { ok: true, plan: fromChat && fromChat.open ? fromChat : null };
}

/**
 * Build the proposal for the approval card. Writes nothing; refuses ids no
 * tool returned, people not listed, a plan that is not the client's own.
 */
export async function buildRequestsProposal(
  input: ProposeRequestsInput,
  ctx: { clientId: string; seenIds: ReadonlySet<string> },
  lookups: AskLookups,
): Promise<{ ok: true; payload: PeopleRequestsPayload; summary: ApprovalSummary } | Refusal> {
  try {
    if (!(await lookups.flagsOn())) return ASK_OFF;
  } catch {
    return ASK_OFF;
  }
  const now = lookups.now();
  const date = readDate(input.date, now, lookups);
  if (!date.ok) return date;
  if (!date.iso) return { ok: false, code: 'bad_date', message: 'Ask which day the shoot is, then ask the people.' };
  const dateEnd = readDate(input.date_end, now, lookups);
  if (!dateEnd.ok) return dateEnd;
  if (dateEnd.iso && dateEnd.iso < date.iso) return { ok: false, code: 'bad_date', message: 'The last day cannot come before the first day.' };
  if (dateEnd.iso && daysBetween(date.iso, dateEnd.iso) + 1 > REQUEST_MAX_DAYS) return { ok: false, code: 'bad_date', message: `One request covers at most ${REQUEST_MAX_DAYS} days.` };
  const place = cleanLine(input.place, 80);
  if (!place) return { ok: false, code: 'bad_request', message: 'Ask where the shoot is (the area), then ask the people.' };
  const brief = cleanLine(input.brief, PLAN_POLICY.maxOutcomeChars);
  const arrival = typeof input.arrival === 'string' && TIME.test(input.arrival.trim()) ? input.arrival.trim() : PLAN_POLICY.askDefaults.arrival;
  if (!Array.isArray(input.requests) || input.requests.length === 0) return { ok: false, code: 'empty', message: 'There is nobody to ask yet. Call find_people first.' };
  if (input.requests.length > PLAN_POLICY.maxAskAtOnce) return { ok: false, code: 'too_many', message: `At most ${PLAN_POLICY.maxAskAtOnce} people can be asked at once.` };

  let prior: Set<string> | null = null;
  const known = async (id: string): Promise<boolean> => {
    const key = id.toLowerCase();
    if (ctx.seenIds.has(key)) return true;
    if (!prior) {
      try {
        prior = await lookups.priorIds();
      } catch {
        prior = new Set();
      }
    }
    return prior.has(key);
  };

  let plan: AskPlan | null;
  try {
    const picked = await pickPlan(ctx.clientId, input.project_id, lookups);
    if (!picked.ok) return picked;
    plan = picked.plan;
  } catch {
    return CHECK_FAILED;
  }

  const requests: AskRequest[] = [];
  const people: AskPerson[] = [];
  const usedNeeds = new Set<string>();
  try {
    for (const raw of input.requests as unknown[]) {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      if (!isUuid(r.person_role_id) || !(await known(r.person_role_id))) return UNKNOWN_ID;
      const id = r.person_role_id.toLowerCase();
      if (requests.some((x) => x.person_role_id === id)) continue;
      const person = await lookups.person(id);
      if (!person) return { ok: false, code: 'not_found', message: 'One of those people is not listed any more. Search again with find_people.' };
      if (!person.roleLive) return { ok: false, code: 'not_live', message: `${person.roleName} cannot be booked right now.` };
      // The need it fills: the one named when it is this plan's need in this role, else the first open need in this role.
      let need: string | null = null;
      if (plan) {
        const fits = plan.needs.filter((n) => n.roleSlug === person.roleSlug && !usedNeeds.has(n.itemId));
        need = (isUuid(r.need_item_id) && fits.find((n) => n.itemId === r.need_item_id)?.itemId) || fits[0]?.itemId || null;
        if (need) usedNeeds.add(need);
      }
      requests.push({ person_role_id: id, role_slug: person.roleSlug, need_item_id: need, hours: hoursFor(r.hours ?? input.hours, person.unit) });
      people.push(person);
    }
  } catch {
    return CHECK_FAILED;
  }

  const payload: PeopleRequestsPayload = { project_id: plan?.id ?? null, date: date.iso, date_end: dateEnd.iso && dateEnd.iso !== date.iso ? dateEnd.iso : null, place, brief, arrival, requests };
  return { ok: true, payload, summary: requestsSummary(payload, people, plan) };
}

/** The approval card: one line per request (role and day, never a name), and what approving does. */
export function requestsSummary(p: PeopleRequestsPayload, people: readonly AskPerson[], plan: Pick<AskPlan, 'title'> | null): ApprovalSummary {
  const n = p.requests.length;
  const lines = p.requests.map((r, i) => {
    const person = people[i];
    const unit = person?.unit ?? null;
    const days = askDays(p, unit);
    return `${person?.roleName ?? 'Person'}: asked for ${daysWords(days)}, from ${p.arrival}${unit ? `, ${hoursWords(r.hours, unit)}` : ''}`;
  });
  const days = askDays(p, null);
  return {
    title: n === 1 ? 'Ask 1 person?' : `Ask ${n} people?`,
    details: [...lines, `Where: ${p.place}`, ...(p.brief ? [`Brief: ${p.brief}`] : []), ...(plan ? [`Each answer shows on your plan: ${cleanLine(plan.title, 80)}`] : [])],
    period: daysWords(p.date_end ? days : [p.date]),
    lines: [],
    depositCents: 0,
    totalCents: 0,
    collection: null,
    cancellationPolicy: 'Asking costs nothing and books nothing. You pay only once someone says yes and you choose to confirm.',
    nextStep: `Approving sends ${n === 1 ? 'the request' : `${n} requests`} now. Each person answers on their own, within ${replyWithin}.`,
    noCharge: true,
    doneMessage: `Asked. They reply within ${replyWithin}. ${plan ? 'Your plan shows each answer.' : 'Your requests page shows each answer.'}`,
  };
}

/** A stored payload, checked again before it is used. Null when it does not fit. */
export function validateRequestsPayload(raw: unknown): PeopleRequestsPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!isIsoDate(p.date)) return null;
  const dateEnd = isIsoDate(p.date_end) && p.date_end > p.date ? p.date_end : null;
  const place = cleanLine(p.place, 80);
  const arrival = typeof p.arrival === 'string' && TIME.test(p.arrival) ? p.arrival : null;
  if (!place || !arrival || !Array.isArray(p.requests) || p.requests.length === 0 || p.requests.length > PLAN_POLICY.maxAskAtOnce) return null;
  if (p.project_id !== null && p.project_id !== undefined && !isUuid(p.project_id)) return null;
  const requests: AskRequest[] = [];
  for (const raw of p.requests as unknown[]) {
    const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
    if (!r || !isUuid(r.person_role_id) || typeof r.role_slug !== 'string' || !/^[a-z0-9-]{2,40}$/.test(r.role_slug)) return null;
    const hours = Number(r.hours);
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 24) return null;
    if (requests.some((x) => x.person_role_id === r.person_role_id)) return null;
    requests.push({ person_role_id: r.person_role_id, role_slug: r.role_slug, need_item_id: isUuid(r.need_item_id) ? r.need_item_id : null, hours });
  }
  return { project_id: isUuid(p.project_id) ? p.project_id : null, date: p.date, date_end: dateEnd, place, brief: cleanLine(p.brief, PLAN_POLICY.maxOutcomeChars), arrival, requests };
}

/**
 * The commit's requote: every check runs again (flags, shape, the first day
 * not past, each person still listed in a live role and in the same role,
 * the plan still the client's own and open). Always 0.
 */
export async function checkRequestsPayload(
  clientId: string,
  raw: unknown,
  lookups: Pick<AskLookups, 'flagsOn' | 'person' | 'plan' | 'now'>,
): Promise<{ ok: true; payload: PeopleRequestsPayload; people: AskPerson[]; plan: AskPlan | null; amountCents: 0 } | Refusal> {
  try {
    if (!(await lookups.flagsOn())) return ASK_OFF;
  } catch {
    return ASK_OFF;
  }
  const p = validateRequestsPayload(raw);
  if (!p) return { ok: false, code: 'bad_request', message: 'That request is not complete. Ask Ubunye again.' };
  if (p.date < saToday(lookups.now())) return { ok: false, code: 'bad_date', message: 'That day has passed, so nobody was asked. Ask Ubunye again with a new date.' };
  try {
    let plan: AskPlan | null = null;
    if (p.project_id) {
      plan = await lookups.plan(clientId, p.project_id);
      if (!plan) return { ok: false, code: 'not_owner', message: 'That plan is not yours, so nobody was asked.' };
      if (!plan.open) return { ok: false, code: 'closed', message: 'That plan is closed, so nobody was asked.' };
    }
    const people: AskPerson[] = [];
    for (const r of p.requests) {
      const person = await lookups.person(r.person_role_id);
      if (!person || person.roleSlug !== r.role_slug) return { ok: false, code: 'not_found', message: 'One of those people is not listed any more, so nobody was asked. Ask Ubunye to search again.' };
      if (!person.roleLive) return { ok: false, code: 'not_live', message: `${person.roleName} cannot be booked right now, so nobody was asked.` };
      people.push(person);
    }
    return { ok: true, payload: p, people, plan, amountCents: 0 };
  } catch {
    return CHECK_FAILED;
  }
}

export type AskResult =
  | { role: string; status: 'created'; request_id: string; short_notice: boolean; in_plan: boolean | null }
  | { role: string; status: 'already_open'; request_id: string; in_plan: boolean | null }
  | { role: string; status: 'refused'; reason: string };

export interface AskExecuteDeps extends Pick<AskLookups, 'flagsOn' | 'person' | 'plan' | 'now'> {
  /** The shared send (lib/roles/request-send.ts) for this client. */
  send(body: Record<string, unknown>): Promise<SendRequestOutcome>;
  /** Join the request to the plan (project_link_item), filling the need when given. */
  link(projectId: string, requestId: string, needItemId: string | null): Promise<boolean>;
  /** Tell the owner, the person (blind) and the client, after the response. Never throws. */
  notify(requestId: string): void;
  /** The same hourly limit as the request form. False: this one is not sent. */
  allow?(): Promise<boolean>;
}

/**
 * Send each request through the shared rules, one by one. ok: false only
 * when nothing could be checked or no request went through at all; otherwise
 * the per-request results, partial or not.
 */
export async function executeRequests(
  clientId: string,
  raw: unknown,
  approvedAmountCents: number,
  deps: AskExecuteDeps,
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; message: string }> {
  if (approvedAmountCents !== 0) return { ok: false, message: 'Asking people costs nothing; this approval does not match, so nobody was asked.' };
  const checked = await checkRequestsPayload(clientId, raw, deps);
  if (!checked.ok) return { ok: false, message: checked.message };
  const { payload: p, people, plan } = checked;

  const results: AskResult[] = [];
  for (const [i, r] of p.requests.entries()) {
    const role = people[i].roleName;
    try {
      if (deps.allow && !(await deps.allow())) {
        results.push({ role, status: 'refused', reason: 'Too many requests in an hour. Try again later.' });
        continue;
      }
      const out = await deps.send({
        person_role_id: r.person_role_id,
        dates: askDays(p, people[i].unit),
        arrival: p.arrival,
        hours: r.hours,
        area: p.place,
        note: p.brief || null,
      });
      if (out.kind === 'refused') {
        results.push({ role, status: 'refused', reason: out.message });
        continue;
      }
      if (out.kind === 'created') deps.notify(out.id);
      let inPlan: boolean | null = null;
      if (plan) {
        try {
          inPlan = await deps.link(plan.id, out.id, r.need_item_id);
        } catch {
          inPlan = false;
        }
      }
      results.push(out.kind === 'created'
        ? { role, status: 'created', request_id: out.id, short_notice: out.shortNotice, in_plan: inPlan }
        : { role, status: 'already_open', request_id: out.id, in_plan: inPlan });
    } catch {
      results.push({ role, status: 'refused', reason: 'Could not send this one just now. Try again in a moment.' });
    }
  }

  const created = results.filter((x) => x.status === 'created').length;
  const open = results.filter((x) => x.status === 'already_open').length;
  const refused = results.length - created - open;
  const lines = results.map(askResultLine);
  if (created + open === 0) return { ok: false, message: `Nobody was asked. ${lines.join(' ')}` };
  const head = refused === 0
    ? `Asked. They reply within ${replyWithin}.`
    : `Asked ${created + open} of ${results.length}. They reply within ${replyWithin}.`;
  const notLinked = results.some((x) => x.status !== 'refused' && x.in_plan === false);
  return {
    ok: true,
    result: {
      results,
      created,
      already_open: open,
      refused,
      ...(plan ? { project_id: plan.id } : {}),
      next: plan ? `/dashboard/plans/${plan.id}` : '/dashboard/creator-requests',
      message: [head, ...lines, plan ? (notLinked ? 'Some could not be added to your plan; they are on your requests page.' : 'Your plan shows each answer.') : 'Your requests page shows each answer.'].join(' '),
    },
  };
}

/** One request's outcome in plain words, no names. */
export function askResultLine(r: AskResult): string {
  if (r.status === 'created') return `${r.role}: asked${r.short_notice ? ' (very short notice, they may not reply in time)' : ''}.`;
  if (r.status === 'already_open') return `${r.role}: already asked, that request is still open.`;
  return `${r.role}: not asked. ${r.reason}`;
}
