import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getFlag } from '@/lib/features';
import { checkRateLimit } from '@/lib/auth';
import { resolveDate } from '@/lib/dates/johannesburg';
import { logEvent } from '@/lib/data/events';
import { effectiveUnit } from '@/lib/roles/pricing';
import type { PricingUnit } from '@/lib/roles/types';
import { sendPeopleRequest } from '@/lib/roles/request-send';
import { peopleRequestDeps } from '@/lib/roles/request-send-server';
import { notifyNewRequest } from '@/lib/roles/request-notify-server';
import { addItem, validateNeed } from '@/lib/core/projects/use-cases';
import { isUuid } from '@/lib/core/projects/plan';
import { checkRequestsPayload, executeRequests, type AskLookups, type AskPerson, type AskPlan } from '@/lib/core/projects/requests';
import { priorToolIds } from './agent';
import { SupabaseProjectStore } from './store';

/**
 * Server wiring for "Ask everyone" (approval kind people_requests): the
 * lookups propose_requests uses, and the requote and execute steps the
 * approval commit calls. Each request is sent through the same rules as the
 * request form (lib/roles/request-send.ts) and joined to the plan through
 * the plan service (project_link_item). Service role reads, always filtered
 * by the signed-in client's id; person_roles is read for role and pricing
 * unit only, never a user id or a name.
 */

type Admin = ReturnType<typeof createAdminClient>;

async function flagsOn(): Promise<boolean> {
  const [plans, people] = await Promise.all([getFlag('ubunye_projects'), getFlag('roles_v1')]);
  return plans && people;
}

async function readPerson(db: Admin, id: string): Promise<AskPerson | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from('person_roles').select('id, role_slug, pricing_unit').eq('id', id).eq('status', 'approved').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: role, error: e2 } = await db.from('roles').select('slug, name, status, pricing_unit').eq('slug', data.role_slug as string).maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!role) return null;
  return {
    id: data.id as string,
    roleSlug: role.slug as string,
    roleName: role.name as string,
    roleLive: role.status === 'live',
    unit: effectiveUnit(role.pricing_unit as PricingUnit, (data.pricing_unit as PricingUnit | null) ?? null),
  };
}

async function readPlan(db: Admin, clientId: string, projectId: string): Promise<AskPlan | null> {
  if (!isUuid(clientId) || !isUuid(projectId)) return null;
  const { data, error } = await db.from('projects').select('id, title, status').eq('id', projectId).eq('client_id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: items, error: e2 } = await db.from('project_items').select('id, need').eq('project_id', projectId).eq('kind', 'need').order('created_at', { ascending: true });
  if (e2) throw new Error(e2.message);
  const needs = ((items ?? []) as { id: string; need: unknown }[])
    .map((r) => ({ itemId: r.id, need: validateNeed(r.need) }))
    .filter((r) => r.need?.type === 'person' && r.need.status === 'to_book' && !!r.need.role_slug)
    .map((r) => ({ itemId: r.itemId, roleSlug: r.need!.role_slug as string }));
  return { id: data.id as string, title: data.title as string, open: data.status === 'open', needs };
}

/** The lookups propose_requests uses for one conversation. */
export function askLookups(p: { conversationId: string | null }): AskLookups {
  const db = createAdminClient();
  return {
    flagsOn,
    person: (id) => readPerson(db, id),
    plan: (clientId, projectId) => readPlan(db, clientId, projectId),
    chatPlan: async (clientId) => {
      if (!p.conversationId || !isUuid(p.conversationId) || !isUuid(clientId)) return null;
      const { data, error } = await db
        .from('projects')
        .select('id')
        .eq('client_id', clientId)
        .eq('source_conversation_id', p.conversationId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? readPlan(db, clientId, data.id as string) : null;
    },
    priorIds: () => priorToolIds(p.conversationId),
    resolveDate,
    now: () => new Date(),
  };
}

/** The commit's requote for "Ask everyone": it costs nothing, but every check runs again first. */
export async function requestsRequote(userId: string, payload: Record<string, unknown>): Promise<{ ok: true; amountCents: number } | { ok: false; message: string }> {
  const db = createAdminClient();
  const out = await checkRequestsPayload(userId, payload, { flagsOn, person: (id) => readPerson(db, id), plan: (c, id) => readPlan(db, c, id), now: () => new Date() });
  return out.ok ? { ok: true, amountCents: 0 } : { ok: false, message: out.message };
}

/** Tell people after the commit's response is sent; outside a request, still try. */
function notifyLater(requestId: string): void {
  const run = () => notifyNewRequest(requestId).then(() => undefined).catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

/** The commit's execute for "Ask everyone": each request through the shared rules, one by one. */
export async function requestsExecute(userId: string, payload: Record<string, unknown>, approvedAmountCents: number): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; message: string }> {
  const db = createAdminClient();
  const store = new SupabaseProjectStore(db);
  const out = await executeRequests(userId, payload, approvedAmountCents, {
    flagsOn,
    person: (id) => readPerson(db, id),
    plan: (c, id) => readPlan(db, c, id),
    now: () => new Date(),
    send: (body) => sendPeopleRequest(userId, body, peopleRequestDeps(userId), { liveRoleOnly: true }),
    link: async (projectId, requestId, needItemId) => (await addItem(store, { clientId: userId, projectId, kind: 'people_request', refId: requestId, replacesNeedId: needItemId })).ok,
    notify: notifyLater,
    // The same hourly limit as the request form (app/api/roles/requests).
    allow: () => checkRateLimit(`roles-request:${userId}`, 10, 60 * 60_000),
  });
  if (out.ok) {
    const r = out.result as { created?: number; already_open?: number; refused?: number; project_id?: string };
    logEvent({ eventType: 'people_requests_sent', eventCategory: 'booking', userId, metadata: { created: r.created, already_open: r.already_open, refused: r.refused, project_id: r.project_id ?? null, source: 'ubunye_approved' } });
  }
  return out;
}
