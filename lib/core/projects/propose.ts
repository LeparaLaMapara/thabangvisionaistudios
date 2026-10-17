/**
 * propose_plan, the deterministic part. The model suggests a title and parts;
 * this code decides everything that matters, from our own data:
 *
 *  - every id must be one a tool returned in this conversation (seenIds,
 *    plus ids stored with earlier messages), then is checked again here:
 *    a profile must be approved and in the named role, a listing published,
 *    a booking or request the client's own and in no other plan;
 *  - what each part is (bookable person, gear, coming soon, not offered)
 *    comes from the roles table, never from the model's wording;
 *  - one part alone never makes a plan (planNeeded).
 *
 * The result is a proposal for the approval card. Nothing is written until
 * the client presses Approve (lib/core/agent, kind project_create).
 */

import { PLAN_POLICY, RENTAL_CATEGORY_VALUES } from '@/lib/constants';
import { shootTypeBySlug, type ShootType } from '@/lib/ubunye/shoot-types';
import { assignTimeline } from './timeline';
import { formatSaDay, isIsoDate, saToday, type ResolvedDate } from '@/lib/dates/johannesburg';
import type { ApprovalSummary } from '@/lib/core/agent/use-cases';
import { briefLine, cleanLine, dedupeParts, dueWords, isRefKind, isUuid, makeBrief, needWords, planNeeded, type PlanNeed, type PlanPart, type PlanPayload, type ProjectRefKind } from './plan';
import { checkRefs, PLANS_OFF, type ProjectStore, type Refusal } from './use-cases';

export interface PlanRole {
  slug: string;
  name: string;
  status: string;
}

export interface PlanLookups {
  store: ProjectStore;
  roles(): Promise<PlanRole[]>;
  /** The live or coming-soon role plain words mean (the same matcher find_people uses). */
  resolveRole(words: string, roles: PlanRole[]): PlanRole | null;
  /** An approved blind profile: its role only. Null when not approved or missing. */
  personRole(id: string): Promise<{ id: string; roleSlug: string } | null>;
  /** A published listing. Null when missing. */
  rental(id: string): Promise<{ id: string; title: string; category?: string } | null>;
  /** One blind line for the client's own booking or request ("Photographer or videographer (Sat 24 Oct): waiting for their reply"). Null when not theirs. */
  describeRef(clientId: string, kind: ProjectRefKind, id: string): Promise<string | null>;
  /** Ids our tools returned in earlier turns of this conversation. */
  priorIds(): Promise<Set<string>>;
  resolveDate(text: string, now: Date): ResolvedDate | null;
  now(): Date;
}

export interface RawPlanPart {
  label?: unknown;
  type?: unknown;
  role?: unknown;
  person_id?: unknown;
  rental_id?: unknown;
  category?: unknown;
  existing_kind?: unknown;
  existing_id?: unknown;
}

export interface ProposePlanInput {
  title?: unknown;
  outcome?: unknown;
  place?: unknown;
  date?: unknown;
  date_end?: unknown;
  budget?: unknown;
  /** A shoot type slug (plan_outline returned it), for the timeline. */
  shoot_type?: unknown;
  parts?: unknown;
}

/**
 * The shoot type for a plan: only a slug from our catalogue that the model
 * passed on from plan_outline. No guessing from the title here: a plan made
 * without an outline keeps its parts as they were, with no timeline.
 */
export function planShootType(slug: unknown): ShootType | null {
  const given = shootTypeBySlug(slug);
  return given && given.slug !== 'general' ? given : null;
}

const categoryOf = (v: unknown): string | undefined => (typeof v === 'string' && (RENTAL_CATEGORY_VALUES as readonly string[]).includes(v) ? v : undefined);

const UNKNOWN_ID: Refusal = {
  ok: false,
  code: 'unknown_id',
  message: 'Use only ids a tool returned in this chat (find_people, search_gear, my_plan_parts). Search again, then propose the plan.',
};

function readDate(raw: unknown, now: Date, lookups: PlanLookups): { ok: true; date: ResolvedDate | null } | Refusal {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: true, date: null };
  const t = raw.trim();
  const date = isIsoDate(t) ? { iso: t, label: formatSaDay(t), rule: 'as given' } : lookups.resolveDate(t, now);
  const today = saToday(now);
  if (!date) return { ok: false, code: 'bad_date', message: `I could not read "${cleanLine(t, 40)}" as a date. Today is ${formatSaDay(today)}. Ask which day they mean.` };
  if (date.iso < today) return { ok: false, code: 'bad_date', message: `${date.label} has passed. Today is ${formatSaDay(today)}. Ask which day they mean.` };
  return { ok: true, date };
}

export async function buildPlanProposal(
  input: ProposePlanInput,
  ctx: { clientId: string; conversationId: string | null; seenIds: ReadonlySet<string> },
  lookups: PlanLookups,
): Promise<{ ok: true; payload: PlanPayload; summary: ApprovalSummary } | Refusal> {
  try {
    if (!(await lookups.store.flagOn())) return PLANS_OFF;
  } catch {
    return PLANS_OFF;
  }
  const now = lookups.now();
  const outcome = cleanLine(input.outcome, PLAN_POLICY.maxOutcomeChars);
  const title = cleanLine(input.title, PLAN_POLICY.maxTitleChars) || cleanLine(outcome, PLAN_POLICY.maxTitleChars);
  if (!title) return { ok: false, code: 'bad_request', message: 'Give the plan a short title, like "Music video in Soweto".' };
  const date = readDate(input.date, now, lookups);
  if (!date.ok) return date;
  const dateEnd = readDate(input.date_end, now, lookups);
  if (!dateEnd.ok) return dateEnd;
  if (!Array.isArray(input.parts) || input.parts.length === 0) return { ok: false, code: 'empty', message: 'There is nothing to put in a plan yet.' };
  if (input.parts.length > PLAN_POLICY.maxParts) return { ok: false, code: 'too_many', message: `A plan holds at most ${PLAN_POLICY.maxParts} parts.` };

  let prior: Set<string> | null = null;
  const known = async (raw: string): Promise<boolean> => {
    const id = raw.toLowerCase();
    if (ctx.seenIds.has(id)) return true;
    if (!prior) {
      try {
        prior = await lookups.priorIds();
      } catch {
        prior = new Set();
      }
    }
    return prior.has(id);
  };

  let roles: PlanRole[];
  try {
    roles = await lookups.roles();
  } catch {
    roles = [];
  }
  if (!roles.length) return { ok: false, code: 'check_failed', message: 'Plans are not available just now. Try again in a moment.' };

  const asRole = (words: string, label: string): PlanNeed => {
    const role = lookups.resolveRole(words, roles);
    if (!role) return { type: 'unsupported', status: 'not_offered', label: label || 'Something else' };
    if (role.status === 'live') return { type: 'person', status: 'to_book', label: role.name, role_slug: role.slug };
    return { type: 'unsupported', status: 'coming_soon', label: role.name, role_slug: role.slug };
  };

  const parts: PlanPart[] = [];
  try {
    for (const raw of input.parts as RawPlanPart[]) {
      if (!raw || typeof raw !== 'object') return { ok: false, code: 'bad_request', message: 'Each part needs a label and a type.' };
      const label = cleanLine(raw.label, PLAN_POLICY.maxPartLabelChars);
      const type = typeof raw.type === 'string' ? raw.type : 'other';
      if (type === 'existing') {
        if (!isRefKind(raw.existing_kind) || !isUuid(raw.existing_id) || !(await known(raw.existing_id))) return UNKNOWN_ID;
        const line = await lookups.describeRef(ctx.clientId, raw.existing_kind, raw.existing_id);
        if (!line) return { ok: false, code: 'not_owner', message: 'One of those bookings is not yours, so it cannot go in a plan.' };
        parts.push({ kind: raw.existing_kind, ref_id: raw.existing_id, label: cleanLine(line, 120) });
      } else if (type === 'gear') {
        if (raw.rental_id !== undefined && raw.rental_id !== null && raw.rental_id !== '') {
          if (!isUuid(raw.rental_id) || !(await known(raw.rental_id))) return UNKNOWN_ID;
          const rental = await lookups.rental(raw.rental_id);
          if (!rental) return { ok: false, code: 'not_found', message: 'That gear is not listed any more. Search again.' };
          const category = categoryOf(rental.category) ?? categoryOf(raw.category);
          parts.push({ kind: 'need', need: { type: 'gear', status: 'to_book', label: cleanLine(rental.title, PLAN_POLICY.maxPartLabelChars), rental_id: rental.id, ...(category ? { category } : {}) } });
        } else {
          const category = categoryOf(raw.category);
          parts.push({ kind: 'need', need: { type: 'gear', status: 'to_book', label: label || 'Gear', ...(category ? { category } : {}) } });
        }
      } else if (type === 'person') {
        const need = asRole(cleanLine(raw.role, 60) || label, label);
        if (raw.person_id !== undefined && raw.person_id !== null && raw.person_id !== '') {
          if (!isUuid(raw.person_id) || !(await known(raw.person_id))) return UNKNOWN_ID;
          const pr = await lookups.personRole(raw.person_id);
          if (!pr || need.type !== 'person' || pr.roleSlug !== need.role_slug) {
            return { ok: false, code: 'not_found', message: 'That profile is not available in that role. Search again with find_people.' };
          }
          need.person_role_id = pr.id;
        }
        parts.push({ kind: 'need', need });
      } else {
        parts.push({ kind: 'need', need: asRole(cleanLine(raw.role, 60) || label, label) });
      }
    }
  } catch {
    return { ok: false, code: 'check_failed', message: 'Could not check that just now. Try again in a moment.' };
  }

  const deduped = dedupeParts(parts);
  const needed = planNeeded(deduped);
  if (!needed.ok) return needed;
  const refs = await checkRefs(lookups.store, ctx.clientId, deduped);
  if (!refs.ok) return refs;

  // The timeline: each part not booked yet gets a "do by" date from the shoot type.
  const shootType = planShootType(input.shoot_type);
  const unique = shootType && date.date ? assignTimeline(shootType, date.date.iso, deduped) : deduped;
  const brief = makeBrief({ outcome: outcome || title, place: input.place, date: date.date, dateEnd: dateEnd.date?.iso ?? null, budget: input.budget, shootType: shootType?.slug ?? null });
  const payload: PlanPayload = { title, brief, parts: unique, source_conversation_id: ctx.conversationId };
  const byPosition = [...unique].sort((a, b) => (a.position ?? 100) - (b.position ?? 100));
  const lines = byPosition.map((p) => {
    const line = p.kind === 'need' ? needWords(p.need) : p.label;
    // A step already past its day says "do this now", like the plan page (dueWords).
    const due = p.due_date ? dueWords(p.due_date, saToday(now)) : null;
    if (!due) return line;
    return `${line} (${due.late ? `do this now, it was due by ${formatSaDay(due.iso)}` : due.words.charAt(0).toLowerCase() + due.words.slice(1)})`;
  });
  const summary: ApprovalSummary = {
    title: `Plan: ${title}`,
    details: [briefLine(brief), ...lines].filter(Boolean),
    period: date.date ? (dateEnd.date && dateEnd.date.iso !== date.date.iso ? `${date.date.label} to ${dateEnd.date.label}` : date.date.label) : 'No date yet',
    lines: [],
    depositCents: 0,
    totalCents: 0,
    collection: null,
    cancellationPolicy: 'Saving a plan books nothing and costs nothing. You can close it at any time.',
    nextStep: 'Approving saves this plan on your dashboard. Each part is still requested, booked and paid on its own.',
    noCharge: true,
  };
  return { ok: true, payload, summary };
}
