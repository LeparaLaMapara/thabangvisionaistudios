import { createAdminClient } from '@/lib/supabase/server';
import { arrivalLabel, firstName, requestReference, type RequestFacts, type RequestStatus } from '@/lib/roles';

/**
 * People requests after they are sent (migration 095): who to tell, what the
 * client's dashboard lists, what staff answer. Service role throughout:
 * role_booking_requests is closed to browsers (091), so every caller checks
 * who is asking first (the signed-in client, or requireAdmin()).
 */

const REQUEST_COLUMNS =
  'id, person_role_id, client_id, requested_date, requested_dates, arrival_time, duration_hours, area, address, note, status, total_cents, created_at, responded_at, client_note, is_demo';

interface RequestRow {
  id: string;
  person_role_id: string;
  client_id: string;
  requested_date: string;
  requested_dates: string[] | null;
  arrival_time: string;
  duration_hours: number | string;
  area: string;
  address: string | null;
  note: string | null;
  status: RequestStatus;
  total_cents: number | null;
  created_at: string;
  responded_at: string | null;
  client_note: string | null;
  is_demo: boolean | null;
}

interface PersonRoleBits {
  id: string;
  user_id: string;
  role_slug: string;
  area: string | null;
  profile_code: string | null;
}

/** "Make-up artist in Soweto (ref MA-1042)": no name, the same words the client and the person both see. */
export function requestPersonLabel(roleName: string, area: string | null, code: string | null): string {
  const where = area?.trim();
  const label = where ? `${roleName} in ${where}` : roleName;
  return code ? `${label} (ref ${code})` : label;
}

function datesOf(r: Pick<RequestRow, 'requested_dates' | 'requested_date'>): string[] {
  return Array.isArray(r.requested_dates) && r.requested_dates.length ? r.requested_dates : [r.requested_date];
}

async function roleNames(slugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!slugs.length) return out;
  const { data } = await createAdminClient().from('roles').select('slug, name').in('slug', [...new Set(slugs)]);
  for (const r of (data ?? []) as { slug: string; name: string }[]) out.set(r.slug, r.name);
  return out;
}

async function personRoles(ids: string[]): Promise<Map<string, PersonRoleBits>> {
  const out = new Map<string, PersonRoleBits>();
  if (!ids.length) return out;
  const { data } = await createAdminClient().from('person_roles').select('id, user_id, role_slug, area, profile_code').in('id', [...new Set(ids)]);
  for (const p of (data ?? []) as PersonRoleBits[]) out.set(p.id, p);
  return out;
}

function toFacts(r: RequestRow, pr: PersonRoleBits | undefined, roleName: string): RequestFacts {
  return {
    requestId: r.id,
    roleName,
    personLabel: requestPersonLabel(roleName, pr?.area ?? null, pr?.profile_code ?? null),
    dates: datesOf(r),
    arrival: arrivalLabel(r.arrival_time),
    durationHours: Number(r.duration_hours),
    area: r.area,
    totalCents: typeof r.total_cents === 'number' ? r.total_cents : null,
  };
}

export interface Contact {
  userId: string;
  name: string | null;
  email: string | null;
}

async function contact(userId: string): Promise<Contact> {
  const admin = createAdminClient();
  const [{ data: prof }, auth] = await Promise.all([
    admin.from('profiles').select('display_name, first_name').eq('id', userId).maybeSingle(),
    admin.auth.admin.getUserById(userId).catch(() => ({ data: { user: null } })),
  ]);
  const name = (prof?.first_name as string | null) || firstName(prof?.display_name as string | null) || null;
  return { userId, name, email: auth.data.user?.email ?? null };
}

export interface LoadedRequest {
  facts: RequestFacts;
  status: RequestStatus;
  address: string | null;
  note: string | null;
  isDemo: boolean;
  client: Contact;
  person: Contact;
}

/** Everything needed to tell people about one request. Null when it is gone. */
export async function loadRequest(requestId: string): Promise<LoadedRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const { data } = await createAdminClient().from('role_booking_requests').select(REQUEST_COLUMNS).eq('id', requestId).maybeSingle();
  if (!data) return null;
  const r = data as unknown as RequestRow;
  const pr = (await personRoles([r.person_role_id])).get(r.person_role_id);
  if (!pr) return null;
  const names = await roleNames([pr.role_slug]);
  const [client, person] = await Promise.all([contact(r.client_id), contact(pr.user_id)]);
  return {
    facts: toFacts(r, pr, names.get(pr.role_slug) ?? 'Person'),
    status: r.status,
    address: r.address,
    note: r.note,
    isDemo: !!r.is_demo,
    client,
    person,
  };
}

// ─── The client's own requests (dashboard Hires) ───────────────────────────

export interface ClientRequestItem {
  id: string;
  status: RequestStatus;
  roleName: string;
  personLabel: string;
  dates: string[];
  area: string;
  totalCents: number | null;
  createdAt: string;
}

export async function listClientRequests(clientId: string): Promise<ClientRequestItem[]> {
  const { data, error } = await createAdminClient()
    .from('role_booking_requests')
    .select(REQUEST_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data?.length) return [];
  const rows = data as unknown as RequestRow[];
  const prs = await personRoles(rows.map((r) => r.person_role_id));
  const names = await roleNames([...prs.values()].map((p) => p.role_slug));
  return rows.map((r) => {
    const pr = prs.get(r.person_role_id);
    const f = toFacts(r, pr, names.get(pr?.role_slug ?? '') ?? 'Person');
    return { id: r.id, status: r.status, roleName: f.roleName, personLabel: f.personLabel, dates: f.dates, area: f.area, totalCents: f.totalCents, createdAt: r.created_at };
  });
}

// ─── Staff (callers must requireAdmin() first) ─────────────────────────────

export type AdminRequestGroup = 'waiting' | 'accepted' | 'booked' | 'closed';

export const ADMIN_REQUEST_GROUPS: Record<AdminRequestGroup, RequestStatus[]> = {
  waiting: ['requested'],
  accepted: ['accepted'],
  booked: ['confirmed', 'completed'],
  closed: ['declined', 'withdrawn'],
};

export interface AdminRequestItem extends ClientRequestItem {
  reference: string;
  arrival: string;
  durationHours: number;
  address: string | null;
  note: string | null;
  clientNote: string | null;
  respondedAt: string | null;
  isDemo: boolean;
  client: Contact;
  person: Contact;
  personRoleId: string;
}

export async function listRequestsForAdmin(group: AdminRequestGroup): Promise<AdminRequestItem[]> {
  const { data, error } = await createAdminClient()
    .from('role_booking_requests')
    .select(REQUEST_COLUMNS)
    .in('status', ADMIN_REQUEST_GROUPS[group])
    .order('created_at', { ascending: group === 'waiting' || group === 'accepted' })
    .limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RequestRow[];
  if (!rows.length) return [];
  const prs = await personRoles(rows.map((r) => r.person_role_id));
  const names = await roleNames([...prs.values()].map((p) => p.role_slug));
  const people = new Map<string, Contact>();
  const ids = [...new Set([...rows.map((r) => r.client_id), ...[...prs.values()].map((p) => p.user_id)])];
  await Promise.all(ids.map(async (id) => people.set(id, await contact(id))));
  return rows.map((r) => {
    const pr = prs.get(r.person_role_id);
    const f = toFacts(r, pr, names.get(pr?.role_slug ?? '') ?? 'Person');
    return {
      id: r.id,
      status: r.status,
      roleName: f.roleName,
      personLabel: f.personLabel,
      dates: f.dates,
      area: f.area,
      totalCents: f.totalCents,
      createdAt: r.created_at,
      reference: requestReference(r.id),
      arrival: f.arrival,
      durationHours: f.durationHours,
      address: r.address,
      note: r.note,
      clientNote: r.client_note,
      respondedAt: r.responded_at,
      isDemo: !!r.is_demo,
      client: people.get(r.client_id) ?? { userId: r.client_id, name: null, email: null },
      person: people.get(pr?.user_id ?? '') ?? { userId: pr?.user_id ?? '', name: null, email: null },
      personRoleId: r.person_role_id,
    };
  });
}

export async function requestGroupCounts(): Promise<Record<AdminRequestGroup, number>> {
  const admin = createAdminClient();
  const groups = Object.keys(ADMIN_REQUEST_GROUPS) as AdminRequestGroup[];
  const counts = await Promise.all(
    groups.map(async (g) => {
      const { count } = await admin.from('role_booking_requests').select('id', { count: 'exact', head: true }).in('status', ADMIN_REQUEST_GROUPS[g]);
      return [g, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<AdminRequestGroup, number>;
}

/**
 * Moves a request on, only from the status it is expected to be in (so two
 * staff pressing at once cannot both send emails). False: it had moved.
 */
export async function moveRequest(
  requestId: string,
  from: RequestStatus,
  to: RequestStatus,
  by: string,
  clientNote: string | null = null,
): Promise<boolean> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, responded_at: now, responded_by: by };
  if (to === 'confirmed') patch.confirmed_at = now;
  if (clientNote !== null) patch.client_note = clientNote;
  const { data, error } = await createAdminClient()
    .from('role_booking_requests')
    .update(patch)
    .eq('id', requestId)
    .eq('status', from)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** The decline note the client sees, when there is one. */
export async function getClientNote(requestId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('role_booking_requests').select('client_note').eq('id', requestId).maybeSingle();
  return (data?.client_note as string | null) ?? null;
}
