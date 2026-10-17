/**
 * "Move my shoot", the pure part. Given what the server read live for every
 * part of a plan, say per part what happens if the shoot moves to a new date:
 *
 *   People request   never moved for the client: we ask the person again,
 *                    with a new request prefilled for the new date
 *   Gear order       a paid order is NEVER changed by Ubunye (our team, on
 *                    WhatsApp); an unpaid hold just lapses, and we say whether
 *                    the gear is free on the new dates (the availability code)
 *   Service booking  our team
 *   Needs            only their "do by" date moves with the plan
 *
 * The only write a move makes is the plan's own date and its needs' due
 * dates (movePlanDate in use-cases.ts, after the client approves). Blind:
 * nothing here names a person.
 */

import { STUDIO } from '@/lib/constants';
import { addDays, formatSaDay } from '@/lib/dates/johannesburg';
import type { NextAction, PlanNeed } from './plan';

export type MoveFacts =
  | { kind: 'people_request'; itemId: string; line: string; status: string; personRoleId: string | null; roleSlug: string | null }
  | {
      kind: 'gear_order';
      itemId: string;
      line: string;
      /** paid: money taken (confirmed, active, out); hold: not paid yet; over: cancelled, expired or done. */
      state: 'paid' | 'hold' | 'over';
      /** Each item of the order on the new dates (null: could not check). */
      items: { title: string; href: string | null; available: boolean | null }[];
    }
  | { kind: 'service_booking'; itemId: string; line: string; over: boolean }
  | {
      kind: 'need';
      itemId: string;
      line: string;
      need: PlanNeed;
      dueDate: string | null;
      /** For gear chosen on the plan: free on the new dates? (null: not checked) */
      rental: { title: string; href: string; available: boolean | null } | null;
    }
  | { kind: 'missing'; itemId: string; line: string };

export interface MoveAdvice {
  itemId: string;
  line: string;
  /** What happens, in plain words. */
  what: string;
  /** True only for what the plan move itself changes (a need's do by date). */
  movesWithPlan: boolean;
  action: NextAction | null;
}

export interface MoveContext {
  projectId: string;
  newDate: string;
  newDateEnd: string | null;
  shiftDays: number | null;
  /** The new start gives the gear notice checkout enforces. */
  gearNoticeOk: boolean;
  whatsappUrl: string;
  area: string | null;
}

function requestHref(personRoleId: string, ctx: MoveContext, needItemId?: string): string {
  const q = new URLSearchParams({ date: ctx.newDate, plan: ctx.projectId });
  if (ctx.newDateEnd && ctx.newDateEnd !== ctx.newDate) {
    const days = Math.round((Date.parse(ctx.newDateEnd) - Date.parse(ctx.newDate)) / 86_400_000) + 1;
    if (days > 1) q.set('days', String(days));
  }
  if (ctx.area) q.set('area', ctx.area);
  if (needItemId) q.set('need', needItemId);
  return `/people/${personRoleId}/request?${q.toString()}`;
}

const TEAM = (ctx: MoveContext): NextAction => ({ label: 'WhatsApp our team', href: ctx.whatsappUrl });

function freeWords(items: { title: string; available: boolean | null }[]): string {
  const free = items.filter((i) => i.available === true).map((i) => i.title);
  const full = items.filter((i) => i.available === false).map((i) => i.title);
  const unknown = items.filter((i) => i.available === null).length;
  const parts: string[] = [];
  if (free.length) parts.push(`free on the new dates: ${free.join(', ')}`);
  if (full.length) parts.push(`fully booked on the new dates: ${full.join(', ')}`);
  if (unknown) parts.push('we could not check the rest');
  return parts.join('; ');
}

export function moveAdvice(facts: readonly MoveFacts[], ctx: MoveContext): MoveAdvice[] {
  const newLabel = formatSaDay(ctx.newDate);
  return facts.map((f): MoveAdvice => {
    const base = { itemId: f.itemId, line: f.line };
    switch (f.kind) {
      case 'missing':
        return { ...base, what: 'We cannot find this part any more, so there is nothing to move.', movesWithPlan: false, action: null };
      case 'people_request': {
        if (f.status === 'confirmed') {
          return { ...base, what: `This booking is paid. ${STUDIO.shortName} never changes a paid booking for you: talk to our team and we will ask the person about ${newLabel}.`, movesWithPlan: false, action: TEAM(ctx) };
        }
        if (f.status === 'requested' || f.status === 'accepted') {
          return {
            ...base,
            what: `A request cannot be moved for you. Send them a new request for ${newLabel} and we ask them again; you can withdraw the old one on its page.`,
            movesWithPlan: false,
            action: f.personRoleId ? { label: 'Ask them for the new date', href: requestHref(f.personRoleId, ctx) } : null,
          };
        }
        return { ...base, what: 'Nothing to move: this request is closed.', movesWithPlan: false, action: null };
      }
      case 'gear_order': {
        const free = freeWords(f.items);
        if (f.state === 'paid') {
          return { ...base, what: `This order is paid. ${STUDIO.shortName} never changes a paid order: talk to our team about the new dates${free ? ` (${free})` : ''}.`, movesWithPlan: false, action: TEAM(ctx) };
        }
        if (f.state === 'hold') {
          const notice = ctx.gearNoticeOk ? '' : ` Gear needs ${STUDIO.rental.minLeadTimeHours} hours' notice, so ${newLabel} cannot be booked online.`;
          const first = f.items.find((i) => i.available !== false && i.href);
          return {
            ...base,
            what: `Not paid yet, so it is only a hold and it will lapse. Book again for the new dates${free ? ` (${free})` : ''}.${notice}`,
            movesWithPlan: false,
            action: first?.href && ctx.gearNoticeOk ? { label: 'Book for the new dates', href: first.href } : null,
          };
        }
        return { ...base, what: 'Nothing to move: this order is closed.', movesWithPlan: false, action: null };
      }
      case 'service_booking':
        return f.over
          ? { ...base, what: 'Nothing to move: this booking is closed.', movesWithPlan: false, action: null }
          : { ...base, what: `${STUDIO.shortName} never changes this booking for you: talk to our team about ${newLabel}.`, movesWithPlan: false, action: TEAM(ctx) };
      case 'need': {
        const due = f.dueDate && ctx.shiftDays !== null ? addDays(f.dueDate, ctx.shiftDays) : null;
        const dueWords = due ? ` The do by date moves to ${formatSaDay(due)}.` : '';
        if (f.need.status === 'not_offered') return { ...base, what: 'We do not offer this, so nothing changes for it.', movesWithPlan: false, action: null };
        if (f.need.status === 'coming_soon') return { ...base, what: `Still coming soon; it stays on the plan for ${newLabel}.`, movesWithPlan: true, action: null };
        if (f.need.type === 'person') {
          const action = f.need.person_role_id
            ? { label: 'Request for the new date', href: requestHref(f.need.person_role_id, ctx, f.itemId) }
            : f.need.role_slug
              ? { label: 'Find someone', href: `/people?role=${encodeURIComponent(f.need.role_slug)}&plan=${ctx.projectId}&need=${f.itemId}` }
              : null;
          return { ...base, what: `Not asked yet, so nothing to undo.${dueWords}`, movesWithPlan: true, action };
        }
        if (f.rental) {
          const free = f.rental.available === true ? `${f.rental.title} is free on the new dates.` : f.rental.available === false ? `${f.rental.title} is fully booked on the new dates; choose other gear.` : 'We could not check it for the new dates.';
          const notice = ctx.gearNoticeOk ? '' : ` Gear needs ${STUDIO.rental.minLeadTimeHours} hours' notice, so ${newLabel} cannot be booked online.`;
          return { ...base, what: `Not booked yet. ${free}${notice}${dueWords}`, movesWithPlan: true, action: f.rental.available === false ? { label: 'See gear', href: '/rentals' } : { label: 'See it', href: f.rental.href } };
        }
        return { ...base, what: `Not booked yet, so nothing to undo.${dueWords}`, movesWithPlan: true, action: null };
      }
    }
  });
}

/** One instruction for the model after a move check. */
export function moveSay(advice: readonly MoveAdvice[], canMove: boolean): string {
  const handOff = advice.some((a) => a.action?.href.startsWith('https://wa.me/'));
  return [
    'Tell the client, part by part, only what is written in "what" for it (keep each to one line).',
    handOff ? 'Paid bookings and orders are never changed by Ubunye: give the WhatsApp link for those.' : '',
    canMove
      ? 'If they want the plan itself moved, call propose_plan_move with the same date: it moves the plan date and the do by dates only, after they press Approve. It changes no booking or request.'
      : 'This plan cannot be moved (it is closed).',
  ]
    .filter(Boolean)
    .join(' ');
}
