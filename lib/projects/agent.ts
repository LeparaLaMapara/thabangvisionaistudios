import { createAdminClient } from '@/lib/supabase/server';
import { PLAN_POLICY } from '@/lib/constants';
import { resolveDate } from '@/lib/dates/johannesburg';
import { logEvent } from '@/lib/data/events';
import { getRoles } from '@/lib/supabase/queries/roles';
import { resolveRole } from '@/lib/agents/tools/people';
import { planNeeded } from '@/lib/core/projects/plan';
import { checkRefs, createProject, PLANS_OFF, validatePayload } from '@/lib/core/projects/use-cases';
import type { PlanLookups, PlanRole } from '@/lib/core/projects/propose';
import type { Role } from '@/lib/roles';
import { SupabaseProjectStore } from './store';
import { describeRef } from './live';

/**
 * Server wiring for plan proposals (kind project_create): the lookups
 * propose_plan uses, and the requote and execute steps the approval commit
 * calls. The commit never trusts the stored payload blindly: the flag, the
 * shape, "is a plan needed" and ownership are checked again.
 */

const UUID = /^[0-9a-f-]{36}$/i;

/** Ids our tools returned in earlier turns of this conversation (chat_messages.tool_ref_ids). */
export async function priorToolIds(conversationId: string | null): Promise<Set<string>> {
  const out = new Set<string>();
  if (!conversationId || !UUID.test(conversationId)) return out;
  const { data, error } = await createAdminClient()
    .from('chat_messages')
    .select('tool_ref_ids')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .not('tool_ref_ids', 'is', null)
    .order('created_at', { ascending: false })
    .limit(PLAN_POLICY.priorMessagesForIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { tool_ref_ids: string[] | null }[]) for (const id of row.tool_ref_ids ?? []) out.add(id);
  return out;
}

export function planLookups(p: { conversationId: string | null }): PlanLookups {
  const admin = createAdminClient();
  return {
    store: new SupabaseProjectStore(admin),
    roles: async () => (await getRoles()).map((r) => ({ slug: r.slug, name: r.name, status: r.status, description: r.description }) as PlanRole),
    resolveRole: (words, roles) => resolveRole(words, roles as unknown as Role[]) as unknown as PlanRole | null,
    personRole: async (id) => {
      // Blind: id and role only, approved profiles only.
      const { data, error } = await admin.from('person_roles').select('id, role_slug').eq('id', id).eq('status', 'approved').maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id as string, roleSlug: data.role_slug as string } : null;
    },
    rental: async (id) => {
      const { data, error } = await admin.from('smart_rentals').select('id, title').eq('id', id).eq('is_published', true).is('deleted_at', null).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id as string, title: data.title as string } : null;
    },
    describeRef: (clientId, kind, id) => describeRef(clientId, kind, id, admin),
    priorIds: () => priorToolIds(p.conversationId),
    resolveDate,
    now: () => new Date(),
  };
}

/** The commit's requote for a plan: it costs nothing, but every check runs again first. */
export async function planRequote(userId: string, payload: Record<string, unknown>): Promise<{ ok: true; amountCents: number } | { ok: false; message: string }> {
  const store = new SupabaseProjectStore();
  try {
    if (!(await store.flagOn())) return { ok: false, message: PLANS_OFF.message };
  } catch {
    return { ok: false, message: PLANS_OFF.message };
  }
  const plan = validatePayload(payload);
  if (!plan) return { ok: false, message: 'That plan is not complete. Ask Ubunye for a new one.' };
  const needed = planNeeded(plan.parts);
  if (!needed.ok) return { ok: false, message: needed.message };
  const refs = await checkRefs(store, userId, plan.parts);
  if (!refs.ok) return { ok: false, message: refs.message };
  return { ok: true, amountCents: 0 };
}

/** The commit's execute for a plan: create it through the plan service. */
export async function planExecute(userId: string, payload: Record<string, unknown>): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; message: string }> {
  const out = await createProject(new SupabaseProjectStore(), { clientId: userId, payload });
  if (!out.ok) return { ok: false, message: out.message };
  logEvent({ eventType: 'plan_created', eventCategory: 'booking', userId, metadata: { project_id: out.projectId, source: 'ubunye_approved' } });
  return { ok: true, result: { project_id: out.projectId, next: `/dashboard/plans/${out.projectId}`, message: 'Your plan is saved. Each part shows where it stands.' } };
}
