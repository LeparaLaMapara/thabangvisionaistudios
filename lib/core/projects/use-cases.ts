/**
 * Ubunye plans: the deterministic service. Storage is a port, so the rules
 * run the same from the approval commit, the People request route and the
 * plan page, and are unit-tested with a fake store.
 *
 * Every write checks, in this order: the ubunye_projects flag, the shape,
 * that a plan is needed at all (planNeeded), and that every referenced
 * booking or request belongs to the client. Any check that cannot run is a
 * refusal (fail closed). The database functions check ownership again
 * (migration 097).
 */

import { PLAN_POLICY } from '@/lib/constants';
import {
  cleanLine,
  dedupeParts,
  isRefKind,
  isUuid,
  planNeeded,
  type PlanBrief,
  type PlanNeed,
  type PlanPart,
  type PlanPayload,
  type ProjectRefKind,
} from './plan';

export interface ProjectStore {
  /** The ubunye_projects flag. */
  flagOn(): Promise<boolean>;
  /** Whether the referenced record is the client's own (equipment order, People request, service booking). */
  ownsRef(clientId: string, kind: ProjectRefKind, refId: string): Promise<boolean>;
  /** Whether the reference already sits in a plan (one booking, one plan). */
  refInPlan(kind: ProjectRefKind, refId: string): Promise<boolean>;
  /** Create the plan and its parts in one transaction; returns the plan id. */
  create(p: { clientId: string; title: string; brief: PlanBrief; conversationId: string | null; parts: PlanPart[] }): Promise<string>;
  link(p: { projectId: string; clientId: string; kind: ProjectRefKind; refId: string; replacesNeedId: string | null }): Promise<{ ok: true; itemId: string } | { ok: false; code: 'not_found' | 'not_owner' | 'other_plan' }>;
  /** Add a need to the client's open plan. Null when there is no such open plan. */
  addNeed(p: { projectId: string; clientId: string; need: PlanNeed }): Promise<string | null>;
  /** Close the client's open plan. False when there is no such open plan. */
  close(p: { projectId: string; clientId: string }): Promise<boolean>;
}

export type Refusal = { ok: false; code: string; message: string };

export const PLANS_OFF: Refusal = { ok: false, code: 'off', message: 'Plans are not available right now.' };
const CHECK_FAILED: Refusal = { ok: false, code: 'check_failed', message: 'We could not check that just now, so nothing was saved. Try again in a moment.' };

const NEED_TYPES = ['person', 'gear', 'unsupported'] as const;
const NEED_STATUSES = ['to_book', 'coming_soon', 'not_offered'] as const;
const SLUG = /^[a-z0-9-]{2,40}$/;

/** A need as stored: every field checked, unknown fields dropped. Null when it does not fit. */
export function validateNeed(raw: unknown): PlanNeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const type = NEED_TYPES.find((t) => t === n.type);
  const status = NEED_STATUSES.find((s) => s === n.status);
  const label = cleanLine(n.label, PLAN_POLICY.maxPartLabelChars);
  if (!type || !status || !label) return null;
  const need: PlanNeed = { type, status, label };
  if (typeof n.role_slug === 'string' && SLUG.test(n.role_slug)) need.role_slug = n.role_slug;
  if (isUuid(n.person_role_id)) need.person_role_id = n.person_role_id;
  if (isUuid(n.rental_id)) need.rental_id = n.rental_id;
  // A person must name a role; a person or gear "to book" is the only kind that points at a profile or listing.
  if (type === 'person' && status === 'to_book' && !need.role_slug) return null;
  if (type !== 'person') delete need.person_role_id;
  if (type !== 'gear') delete need.rental_id;
  return need;
}

/** A stored proposal payload, re-checked before it is used (it came from our own row, but checks are cheap). */
export function validatePayload(raw: unknown): PlanPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const title = cleanLine(p.title, PLAN_POLICY.maxTitleChars);
  if (!title || !Array.isArray(p.parts) || !p.brief || typeof p.brief !== 'object') return null;
  const parts: PlanPart[] = [];
  for (const raw of p.parts as unknown[]) {
    const part = raw as Record<string, unknown> | null;
    if (!part) return null;
    if (part.kind === 'need') {
      const need = validateNeed(part.need);
      if (!need) return null;
      parts.push({ kind: 'need', need });
    } else if (isRefKind(part.kind) && isUuid(part.ref_id)) {
      parts.push({ kind: part.kind, ref_id: part.ref_id, label: cleanLine(part.label, 120) });
    } else {
      return null;
    }
  }
  const b = p.brief as Record<string, unknown>;
  const brief: PlanBrief = {
    outcome: cleanLine(b.outcome, PLAN_POLICY.maxOutcomeChars),
    place: cleanLine(b.place, PLAN_POLICY.maxPlaceChars) || null,
    date: typeof b.date === 'string' ? b.date : null,
    date_label: typeof b.date_label === 'string' ? cleanLine(b.date_label, 60) : null,
    date_end: typeof b.date_end === 'string' ? b.date_end : null,
    budget_cents: Number.isSafeInteger(b.budget_cents) && (b.budget_cents as number) > 0 ? (b.budget_cents as number) : null,
  };
  return { title, brief, parts: dedupeParts(parts), source_conversation_id: isUuid(p.source_conversation_id) ? p.source_conversation_id : null };
}

/**
 * Every reference is the client's own and in no other plan. Run at proposal
 * time and again at commit. A failed read is a refusal.
 */
export async function checkRefs(store: ProjectStore, clientId: string, parts: readonly PlanPart[]): Promise<{ ok: true } | Refusal> {
  try {
    for (const part of parts) {
      if (part.kind === 'need') continue;
      if (!(await store.ownsRef(clientId, part.kind, part.ref_id))) {
        return { ok: false, code: 'not_owner', message: 'One of those bookings is not yours, so nothing was saved.' };
      }
      if (await store.refInPlan(part.kind, part.ref_id)) {
        return { ok: false, code: 'other_plan', message: 'One of those bookings is already in a plan.' };
      }
    }
    return { ok: true };
  } catch {
    return CHECK_FAILED;
  }
}

/** Create a plan from an approved proposal. */
export async function createProject(store: ProjectStore, p: { clientId: string; payload: unknown }): Promise<{ ok: true; projectId: string } | Refusal> {
  try {
    if (!(await store.flagOn())) return PLANS_OFF;
  } catch {
    return CHECK_FAILED;
  }
  if (!isUuid(p.clientId)) return { ok: false, code: 'bad_request', message: 'Please sign in again.' };
  const payload = validatePayload(p.payload);
  if (!payload) return { ok: false, code: 'bad_request', message: 'That plan is not complete. Ask Ubunye for a new one.' };
  const needed = planNeeded(payload.parts);
  if (!needed.ok) return needed;
  const refs = await checkRefs(store, p.clientId, payload.parts);
  if (!refs.ok) return refs;
  try {
    const projectId = await store.create({ clientId: p.clientId, title: payload.title, brief: payload.brief, conversationId: payload.source_conversation_id, parts: payload.parts });
    return { ok: true, projectId };
  } catch {
    return { ok: false, code: 'failed', message: 'Could not save the plan. Nothing else changed; try again.' };
  }
}

/** Attach the client's own booking or request to their open plan (optionally filling a need). */
export async function addItem(
  store: ProjectStore,
  p: { clientId: string; projectId: unknown; kind: unknown; refId: unknown; replacesNeedId?: unknown },
): Promise<{ ok: true; itemId: string } | Refusal> {
  try {
    if (!(await store.flagOn())) return PLANS_OFF;
  } catch {
    return CHECK_FAILED;
  }
  if (!isUuid(p.clientId) || !isUuid(p.projectId) || !isRefKind(p.kind) || !isUuid(p.refId)) {
    return { ok: false, code: 'bad_request', message: 'That cannot be added to a plan.' };
  }
  const replaces = isUuid(p.replacesNeedId) ? p.replacesNeedId : null;
  try {
    if (!(await store.ownsRef(p.clientId, p.kind, p.refId))) return { ok: false, code: 'not_owner', message: 'That booking is not yours.' };
    const out = await store.link({ projectId: p.projectId, clientId: p.clientId, kind: p.kind, refId: p.refId, replacesNeedId: replaces });
    if (out.ok) return out;
    if (out.code === 'other_plan') return { ok: false, code: 'other_plan', message: 'That is already in another plan.' };
    if (out.code === 'not_owner') return { ok: false, code: 'not_owner', message: 'That booking is not yours.' };
    return { ok: false, code: 'not_found', message: 'That plan is not open.' };
  } catch {
    return CHECK_FAILED;
  }
}

/** Remember something on an open plan that we cannot fill yet. */
export async function recordNeed(store: ProjectStore, p: { clientId: string; projectId: unknown; need: unknown }): Promise<{ ok: true; itemId: string } | Refusal> {
  try {
    if (!(await store.flagOn())) return PLANS_OFF;
  } catch {
    return CHECK_FAILED;
  }
  const need = validateNeed(p.need);
  if (!isUuid(p.clientId) || !isUuid(p.projectId) || !need) return { ok: false, code: 'bad_request', message: 'That cannot be added to a plan.' };
  try {
    const itemId = await store.addNeed({ projectId: p.projectId, clientId: p.clientId, need });
    return itemId ? { ok: true, itemId } : { ok: false, code: 'not_found', message: 'That plan is not open.' };
  } catch {
    return CHECK_FAILED;
  }
}

export async function closeProject(store: ProjectStore, p: { clientId: string; projectId: unknown }): Promise<{ ok: true } | Refusal> {
  try {
    if (!(await store.flagOn())) return PLANS_OFF;
    if (!isUuid(p.clientId) || !isUuid(p.projectId)) return { ok: false, code: 'bad_request', message: 'That plan does not exist.' };
    return (await store.close({ projectId: p.projectId, clientId: p.clientId })) ? { ok: true } : { ok: false, code: 'not_found', message: 'That plan is not open.' };
  } catch {
    return CHECK_FAILED;
  }
}
