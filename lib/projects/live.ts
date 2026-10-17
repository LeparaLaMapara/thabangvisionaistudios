import { createAdminClient } from '@/lib/supabase/server';
import { PLAN_POLICY } from '@/lib/constants';
import { isExpiredHold } from '@/lib/rental/availability';
import { requestDays } from '@/lib/roles';
import { saToday } from '@/lib/dates/johannesburg';
import { planSteps, type PlanStep } from '@/lib/core/projects/timeline';
import {
  briefLine,
  orderParts,
  partView,
  planNextAction,
  type PartTimeline,
  type LivePart,
  type PartView,
  type PlanBrief,
  type PlanNeed,
  type ProjectItemKind,
  type ProjectRefKind,
} from '@/lib/core/projects/plan';
import { validateNeed } from '@/lib/core/projects/use-cases';

/**
 * Plans, read live. A plan stores references only; here every referenced
 * row is read now, always filtered by the client's own id as well as the
 * reference (so a reference that stopped being theirs reads as "cannot find
 * this part", never someone else's data). Service role, so the person reading
 * must be the signed-in client; callers pass auth.user.id, never an id from
 * the browser.
 *
 * Blind People rule: from People requests only the role, the days, the
 * status and the total are read. person_roles is read for role_slug only:
 * never user_id, names, faces or contacts.
 */

type Admin = ReturnType<typeof createAdminClient>;

interface ItemRef {
  itemId: string;
  kind: ProjectItemKind;
  refId: string | null;
  need: PlanNeed | null;
  timeline?: PartTimeline;
}

async function roleInfo(db: Admin, slugs: string[]): Promise<Map<string, { name: string; status: string }>> {
  const out = new Map<string, { name: string; status: string }>();
  if (!slugs.length) return out;
  const { data, error } = await db.from('roles').select('slug, name, status').in('slug', [...new Set(slugs)]);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { slug: string; name: string; status: string }[]) out.set(r.slug, { name: r.name, status: r.status });
  return out;
}

/** Live facts for each item. Throws on a read error (the page shows an error, never a guess). */
export async function liveParts(clientId: string, items: ItemRef[], now: Date = new Date(), db: Admin = createAdminClient()): Promise<LivePart[]> {
  const ids = (k: ProjectRefKind) => items.filter((i) => i.kind === k && i.refId).map((i) => i.refId as string);
  const peopleIds = ids('people_request');
  const gearIds = ids('gear_order');
  const serviceIds = ids('service_booking');

  const [people, gear, intents, services] = await Promise.all([
    peopleIds.length
      ? db.from('role_booking_requests').select('id, person_role_id, status, requested_date, requested_dates, total_cents').in('id', peopleIds).eq('client_id', clientId)
      : Promise.resolve({ data: [], error: null }),
    gearIds.length
      ? db.from('equipment_bookings').select('id, checkout_group_id, status, start_date, end_date, hold_expires_at, created_at, smart_rentals(title)').in('checkout_group_id', gearIds).eq('user_id', clientId).order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    gearIds.length
      ? db.from('rental_payment_intents').select('checkout_group_id, expected_amount_cents, state, reference').in('checkout_group_id', gearIds).eq('user_id', clientId)
      : Promise.resolve({ data: [], error: null }),
    serviceIds.length
      ? db.from('bookings').select('id, project_category, status, payment_status, total, shoot_date').in('id', serviceIds).eq('client_id', clientId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [people, gear, intents, services]) if (r.error) throw new Error(r.error.message);

  type PeopleRow = { id: string; person_role_id: string; status: string; requested_date: string; requested_dates: string[] | null; total_cents: number | null };
  type GearRow = { id: string; checkout_group_id: string; status: string; start_date: string | null; end_date: string | null; hold_expires_at: string | null; created_at: string; smart_rentals: { title: string } | { title: string }[] | null };
  type IntentRow = { checkout_group_id: string; expected_amount_cents: number | null; state: string; reference: string | null };
  type ServiceRow = { id: string; project_category: string; status: string; payment_status: string; total: number | null; shoot_date: string | null };

  const peopleRows = (people.data ?? []) as PeopleRow[];
  const prIds = [...new Set(peopleRows.map((r) => r.person_role_id))];
  const prSlugs = new Map<string, string>();
  if (prIds.length) {
    // role_slug only: never user_id.
    const { data, error } = await db.from('person_roles').select('id, role_slug').in('id', prIds);
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as { id: string; role_slug: string }[]) prSlugs.set(p.id, p.role_slug);
  }
  const needSlugs = items.map((i) => i.need?.role_slug).filter((s): s is string => !!s);
  const roles = await roleInfo(db, [...prSlugs.values(), ...needSlugs]);

  const rentalIds = items.map((i) => i.need?.rental_id).filter((s): s is string => !!s);
  const rentals = new Map<string, { title: string; href: string }>();
  if (rentalIds.length) {
    const { data, error } = await db.from('smart_rentals').select('id, title, category, slug').in('id', rentalIds).eq('is_published', true).is('deleted_at', null);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string; title: string; category: string; slug: string }[]) rentals.set(r.id, { title: r.title, href: `/rentals/${r.category}/${r.slug}` });
  }

  const intentByGroup = new Map<string, IntentRow>();
  for (const i of (intents.data ?? []) as IntentRow[]) intentByGroup.set(i.checkout_group_id, i);
  const gearByGroup = new Map<string, GearRow[]>();
  for (const g of (gear.data ?? []) as GearRow[]) gearByGroup.set(g.checkout_group_id, [...(gearByGroup.get(g.checkout_group_id) ?? []), g]);
  const peopleById = new Map(peopleRows.map((r) => [r.id, r]));
  const serviceById = new Map(((services.data ?? []) as ServiceRow[]).map((r) => [r.id, r]));

  return items.map((it): LivePart => {
    if (it.kind === 'people_request') {
      const r = it.refId ? peopleById.get(it.refId) : undefined;
      if (!r) return { kind: 'people_request', itemId: it.itemId, found: false };
      const slug = prSlugs.get(r.person_role_id) ?? null;
      return {
        kind: 'people_request',
        itemId: it.itemId,
        found: true,
        requestId: r.id,
        roleName: (slug && roles.get(slug)?.name) || 'Person',
        roleSlug: slug,
        personRoleId: r.person_role_id,
        status: r.status,
        dates: requestDays(r),
        totalCents: typeof r.total_cents === 'number' ? r.total_cents : null,
      };
    }
    if (it.kind === 'gear_order') {
      const rows = it.refId ? gearByGroup.get(it.refId) ?? [] : [];
      if (!rows.length) return { kind: 'gear_order', itemId: it.itemId, found: false };
      const intent = it.refId ? intentByGroup.get(it.refId) : undefined;
      const statuses = rows.map((g) =>
        g.status === 'pending' && intent?.state !== 'paid' && isExpiredHold({ id: g.id, quantity: 1, status: 'pending', createdAt: g.created_at, paymentReference: null, holdExpiresAt: g.hold_expires_at }, now) ? 'expired' : g.status,
      );
      const titles = rows.map((g) => (Array.isArray(g.smart_rentals) ? g.smart_rentals[0]?.title : g.smart_rentals?.title) ?? 'Gear');
      const starts = rows.map((g) => g.start_date).filter((d): d is string => !!d).sort();
      const ends = rows.map((g) => g.end_date).filter((d): d is string => !!d).sort();
      return {
        kind: 'gear_order',
        itemId: it.itemId,
        found: true,
        titles,
        statuses,
        startDate: starts[0] ?? null,
        endDate: ends[ends.length - 1] ?? null,
        amountCents: typeof intent?.expected_amount_cents === 'number' ? intent.expected_amount_cents : null,
        firstBookingId: rows[0]?.id ?? null,
      };
    }
    if (it.kind === 'service_booking') {
      const r = it.refId ? serviceById.get(it.refId) : undefined;
      if (!r) return { kind: 'service_booking', itemId: it.itemId, found: false };
      return {
        kind: 'service_booking',
        itemId: it.itemId,
        found: true,
        category: r.project_category,
        status: r.status,
        paymentStatus: r.payment_status,
        // bookings.total is whole rands (CLAUDE.md, money units).
        totalCents: typeof r.total === 'number' ? Math.round(r.total * 100) : null,
        shootDate: r.shoot_date,
      };
    }
    const need = it.need ?? { type: 'unsupported' as const, status: 'not_offered' as const, label: 'Something else' };
    const role = need.role_slug ? roles.get(need.role_slug) : undefined;
    return {
      kind: 'need',
      itemId: it.itemId,
      need,
      roleStatus: need.role_slug ? (role ? (role.status === 'live' ? 'live' : 'coming_soon') : 'gone') : null,
      roleName: role?.name ?? null,
      rental: need.rental_id ? rentals.get(need.rental_id) ?? null : null,
    };
  });
}

export interface ProjectView {
  id: string;
  title: string;
  briefLine: string;
  brief: Partial<PlanBrief>;
  status: 'open' | 'closed';
  createdAt: string;
  sourceConversationId: string | null;
  parts: PartView[];
  next: ReturnType<typeof planNextAction>;
  /** The plan's own steps (the shoot day, the edit afterwards), from its shoot type. */
  steps: PlanStep[];
}

type ItemRow = { id: string; kind: ProjectItemKind; ref_id: string | null; need: unknown; due_date?: string | null; step?: string | null; position?: number | null };

/** The plan's items, with the timeline (098) when the columns exist; without it before 098. */
export async function readItems(db: Admin, projectId: string): Promise<ItemRow[]> {
  const read = (cols: string) => db.from('project_items').select(cols).eq('project_id', projectId).order('created_at', { ascending: true });
  let res = await read('id, kind, ref_id, need, due_date, step, position');
  if (res.error) res = await read('id, kind, ref_id, need');
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as unknown as ItemRow[];
}

/** One of the client's plans with every part read live. Null when it is not theirs or does not exist. */
export async function getProjectView(clientId: string, projectId: string, db: Admin = createAdminClient()): Promise<ProjectView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const { data: p, error } = await db
    .from('projects')
    .select('id, title, brief, status, created_at, source_conversation_id')
    .eq('id', projectId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;
  const rows = await readItems(db, projectId);
  const items: ItemRef[] = rows.map((r) => ({
    itemId: r.id,
    kind: r.kind,
    refId: r.ref_id,
    need: r.kind === 'need' ? validateNeed(r.need) : null,
    timeline: { due_date: r.due_date ?? null, step: r.step ?? null, position: r.position ?? null },
  }));
  const brief = (p.brief ?? {}) as Partial<PlanBrief>;
  const now = new Date();
  const today = saToday(now);
  const live = await liveParts(clientId, items, now, db);
  const parts = orderParts(live.map((l, i) => partView(l, projectId, brief, { timeline: items[i].timeline, today })));
  return {
    id: p.id as string,
    title: p.title as string,
    briefLine: briefLine(brief),
    brief,
    status: p.status as 'open' | 'closed',
    createdAt: p.created_at as string,
    sourceConversationId: (p.source_conversation_id as string | null) ?? null,
    parts,
    next: p.status === 'open' ? planNextAction(parts) : null,
    steps: planSteps(brief, today),
  };
}

/**
 * The client's open plan that came from this chat, newest first, with its
 * People needs (item id and role), for "Add to my plan" on chat People
 * cards. Null when there is none. Blind: no people data at all.
 */
export async function openPlanForConversation(clientId: string, conversationId: string, db: Admin = createAdminClient()): Promise<{ id: string; needs: { itemId: string; roleSlug: string }[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const { data, error } = await db
    .from('projects')
    .select('id')
    .eq('client_id', clientId)
    .eq('source_conversation_id', conversationId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: items, error: e2 } = await db.from('project_items').select('id, need').eq('project_id', data.id).eq('kind', 'need');
  if (e2) throw new Error(e2.message);
  const needs = ((items ?? []) as { id: string; need: unknown }[])
    .map((r) => ({ itemId: r.id, need: validateNeed(r.need) }))
    .filter((r) => r.need?.type === 'person' && r.need.status === 'to_book' && !!r.need.role_slug)
    .map((r) => ({ itemId: r.itemId, roleSlug: r.need!.role_slug as string }));
  return { id: data.id as string, needs };
}

export interface PlanListItem {
  id: string;
  title: string;
  briefLine: string;
  status: 'open' | 'closed';
  createdAt: string;
  partCount: number;
}

export async function listPlans(clientId: string, db: Admin = createAdminClient()): Promise<PlanListItem[]> {
  const { data, error } = await db
    .from('projects')
    .select('id, title, brief, status, created_at, project_items(count)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; title: string; brief: Partial<PlanBrief> | null; status: 'open' | 'closed'; created_at: string; project_items: { count: number }[] | null }[]).map((p) => ({
    id: p.id,
    title: p.title,
    briefLine: briefLine(p.brief),
    status: p.status,
    createdAt: p.created_at,
    partCount: p.project_items?.[0]?.count ?? 0,
  }));
}

export interface LinkablePart {
  kind: ProjectRefKind;
  refId: string;
  line: string;
}

/**
 * The client's own open People requests and gear orders that are in no plan
 * yet, newest first, for "Add to this plan" and the my_plan_parts tool. Blind.
 */
export async function listLinkableParts(clientId: string, db: Admin = createAdminClient()): Promise<LinkablePart[]> {
  const [{ data: reqs, error: e1 }, { data: gear, error: e2 }] = await Promise.all([
    db.from('role_booking_requests').select('id, created_at').eq('client_id', clientId).in('status', ['requested', 'accepted', 'confirmed']).order('created_at', { ascending: false }).limit(20),
    db.from('equipment_bookings').select('checkout_group_id, created_at').eq('user_id', clientId).not('checkout_group_id', 'is', null).not('status', 'in', '(cancelled,completed)').order('created_at', { ascending: false }).limit(30),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)?.message);
  const candidates: { kind: ProjectRefKind; refId: string; at: string }[] = [
    ...((reqs ?? []) as { id: string; created_at: string }[]).map((r) => ({ kind: 'people_request' as const, refId: r.id, at: r.created_at })),
    ...[...new Map(((gear ?? []) as { checkout_group_id: string; created_at: string }[]).map((g) => [g.checkout_group_id, g.created_at])).entries()].map(([refId, at]) => ({ kind: 'gear_order' as const, refId, at })),
  ];
  if (!candidates.length) return [];
  const { data: linked, error: e3 } = await db.from('project_items').select('kind, ref_id').in('ref_id', candidates.map((c) => c.refId));
  if (e3) throw new Error(e3.message);
  const taken = new Set(((linked ?? []) as { kind: string; ref_id: string }[]).map((l) => `${l.kind}:${l.ref_id}`));
  const free = candidates.filter((c) => !taken.has(`${c.kind}:${c.refId}`)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, PLAN_POLICY.linkableLimit);
  const live = await liveParts(clientId, free.map((c) => ({ itemId: c.refId, kind: c.kind, refId: c.refId, need: null })), new Date(), db);
  return free
    .map((c, i) => ({ kind: c.kind, refId: c.refId, line: partView(live[i], '', null).line }))
    .filter((_, i) => live[i].kind === 'need' || (live[i] as { found: boolean }).found);
}

/** One blind line for the client's own booking or request. Null when it is not theirs. */
export async function describeRef(clientId: string, kind: ProjectRefKind, refId: string, db: Admin = createAdminClient()): Promise<string | null> {
  const [live] = await liveParts(clientId, [{ itemId: refId, kind, refId, need: null }], new Date(), db);
  if (!live || (live.kind !== 'need' && !live.found)) return null;
  return partView(live, '', null).line;
}
