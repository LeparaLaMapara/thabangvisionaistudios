import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  bestDateOfBirth,
  confirmedJobCount,
  evidenceLevel,
  isVerified,
  parseRole,
  type EvidenceFact,
  type EvidenceLevel,
  type PersonRole,
  type Role,
  type RoleEvidence,
} from '@/lib/roles';

/**
 * Database access for many roles, honest proof (migration 090).
 *
 * Public reads go through the visitor's own client, so RLS decides: the
 * catalogue, approved profiles and the public work of approved profiles.
 * The person's name and photo come from `profiles` with the service role,
 * for approved role profiles only, and only display columns: since 077 the
 * public_profiles view lists creators and gear owners alone, and a make-up
 * artist or driver is neither.
 */

export const PERSON_ROLE_COLUMNS =
  'id, user_id, role_slug, status, evidence_level, headline, about, area, price_cents, per_km_cents, answers, reviewer_note, reviewed_at, legal_verified_at, submitted_at, approved_at, is_demo, created_at, updated_at';

export const EVIDENCE_COLUMNS =
  'id, person_role_id, step_key, kind, source, legal_code, storage_provider, storage_ref, url, is_public, pair_group, pair_side, captured_at, device_summary, note, booking_id, verified_at, is_demo, created_at';

const ROLE_COLUMNS =
  'slug, name, role_group, description, status, min_age, legal_requirements, proof_task, guidelines, pricing_unit, suggested_price_cents, existing_flow_href, sort';

function toRoles(rows: unknown[] | null): Role[] {
  return (rows ?? [])
    .map((r) => parseRole(r as Record<string, unknown>))
    .filter((r): r is Role => r !== null)
    .sort((a, b) => a.sort - b.sort);
}

/** The catalogue, live first then coming soon, in sort order. */
export async function getRoles(): Promise<Role[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('roles').select(ROLE_COLUMNS).order('sort');
  if (error) {
    console.error('[roles] getRoles:', error.message);
    return [];
  }
  return toRoles(data);
}

export async function getRole(slug: string): Promise<Role | null> {
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('roles').select(ROLE_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) {
    console.error('[roles] getRole:', error.message);
    return null;
  }
  return data ? parseRole(data as Record<string, unknown>) : null;
}

/** The signed-in person's row for one role, with all their evidence (RLS: own rows). */
export async function getMyPersonRole(
  supabase: SupabaseClient,
  userId: string,
  slug: string,
): Promise<{ personRole: PersonRole; evidence: RoleEvidence[] } | null> {
  const { data, error } = await supabase
    .from('person_roles')
    .select(PERSON_ROLE_COLUMNS)
    .eq('user_id', userId)
    .eq('role_slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const personRole = data as unknown as PersonRole;
  const { data: ev, error: evError } = await supabase
    .from('role_evidence')
    .select(EVIDENCE_COLUMNS)
    .eq('person_role_id', personRole.id)
    .order('created_at');
  if (evError) throw new Error(evError.message);
  return { personRole, evidence: (ev ?? []) as unknown as RoleEvidence[] };
}

/** Facts about a person the maker needs: ID check state and the date of birth it read. */
export async function getIdentityFacts(
  userId: string,
): Promise<{ identityVerified: boolean; verificationStatus: string | null; dateOfBirthFromId: string | null }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('verification_status, verification_metadata')
    .eq('id', userId)
    .maybeSingle();
  const meta = (data?.verification_metadata ?? null) as { id_document?: { date_of_birth?: string | null } } | null;
  return {
    identityVerified: data?.verification_status === 'verified',
    verificationStatus: (data?.verification_status as string | null) ?? null,
    dateOfBirthFromId: meta?.id_document?.date_of_birth ?? null,
  };
}

export interface PublicPerson {
  display_name: string;
  avatar_url: string | null;
  location: string | null;
  identityVerified: boolean;
}

async function loadPeople(userIds: string[]): Promise<Map<string, PublicPerson>> {
  const out = new Map<string, PublicPerson>();
  if (userIds.length === 0) return out;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, display_name, avatar_url, location, verification_status')
    .in('id', userIds);
  if (error) {
    console.error('[roles] loadPeople:', error.message);
    return out;
  }
  for (const p of data ?? []) {
    out.set(p.id as string, {
      display_name: (p.display_name as string | null) ?? 'Member',
      avatar_url: (p.avatar_url as string | null) ?? null,
      location: (p.location as string | null) ?? null,
      identityVerified: p.verification_status === 'verified',
    });
  }
  return out;
}

export interface PublicRoleProfile {
  personRole: PersonRole;
  role: Role;
  person: PublicPerson;
  work: RoleEvidence[];
  verified: boolean;
  confirmedJobs: number;
}

function toFacts(evidence: readonly RoleEvidence[]): EvidenceFact[] {
  return evidence.map((e) => ({ kind: e.kind, source: e.source, verified: !!e.verified_at }));
}

/** An approved role profile, as any visitor may see it. Null when not approved. */
export async function getPublicRoleProfile(personRoleId: string): Promise<PublicRoleProfile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personRoleId)) return null;
  const supabase = await createClient();
  const { data: pr } = await supabase
    .from('person_roles')
    .select(PERSON_ROLE_COLUMNS)
    .eq('id', personRoleId)
    .eq('status', 'approved')
    .maybeSingle();
  if (!pr) return null;
  const personRole = pr as unknown as PersonRole;
  const [role, evRes, people] = await Promise.all([
    getRole(personRole.role_slug),
    supabase.from('role_evidence').select(EVIDENCE_COLUMNS).eq('person_role_id', personRole.id).order('created_at'),
    loadPeople([personRole.user_id]),
  ]);
  const person = people.get(personRole.user_id);
  if (!role || !person) return null;
  const all = (evRes.data ?? []) as unknown as RoleEvidence[];
  return {
    personRole,
    role,
    person,
    work: all.filter((e) => (e.kind === 'photo' || e.kind === 'video') && e.url),
    verified: isVerified({
      identityVerified: person.identityVerified,
      legalVerified: !!personRole.legal_verified_at,
      roleHasLegal: role.legal_requirements.some((r) => r.required),
    }),
    confirmedJobs: confirmedJobCount(toFacts(all)),
  };
}

export interface ProfileCard {
  id: string;
  roleSlug: string;
  roleName: string;
  name: string;
  headline: string | null;
  area: string | null;
  cover: string | null;
  priceCents: number | null;
  perKmCents: number | null;
  unit: Role['pricing_unit'];
  verified: boolean;
  confirmedJobs: number;
}

/** Approved profiles for the /people grid, optionally one role. */
export async function listApprovedProfiles(roleSlug?: string): Promise<ProfileCard[]> {
  const supabase = await createClient();
  let q = supabase.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('status', 'approved').order('approved_at', { ascending: false }).limit(60);
  if (roleSlug) q = q.eq('role_slug', roleSlug);
  const { data, error } = await q;
  if (error || !data?.length) return [];
  const rows = data as unknown as PersonRole[];
  const [roles, evRes, people] = await Promise.all([
    getRoles(),
    supabase.from('role_evidence').select(EVIDENCE_COLUMNS).in('person_role_id', rows.map((r) => r.id)).order('created_at'),
    loadPeople([...new Set(rows.map((r) => r.user_id))]),
  ]);
  const evidence = (evRes.data ?? []) as unknown as RoleEvidence[];
  const cards: ProfileCard[] = [];
  for (const pr of rows) {
    const role = roles.find((r) => r.slug === pr.role_slug);
    const person = people.get(pr.user_id);
    if (!role || !person) continue;
    const mine = evidence.filter((e) => e.person_role_id === pr.id);
    const cover = mine.find((e) => e.kind === 'photo' && e.url)?.url ?? person.avatar_url;
    cards.push({
      id: pr.id,
      roleSlug: role.slug,
      roleName: role.name,
      name: person.display_name,
      headline: pr.headline,
      area: pr.area ?? person.location,
      cover,
      priceCents: pr.price_cents,
      perKmCents: pr.per_km_cents,
      unit: role.pricing_unit,
      verified: isVerified({
        identityVerified: person.identityVerified,
        legalVerified: !!pr.legal_verified_at,
        roleHasLegal: role.legal_requirements.some((r) => r.required),
      }),
      confirmedJobs: confirmedJobCount(toFacts(mine)),
    });
  }
  return cards;
}

// ─── Admin review (service role; callers must requireAdmin() first) ──────────

export interface ReviewItem {
  personRole: PersonRole;
  role: Role;
  person: PublicPerson & { email: string | null };
  evidence: (RoleEvidence & { viewUrl: string | null })[];
  dateOfBirth: string | null;
  suggestedLevel: EvidenceLevel;
}

const DOC_BUCKET = 'role-documents';
const DOC_LINK_SECONDS = 15 * 60;

export async function listReviewQueue(status: PersonRole['status'] = 'submitted'): Promise<ReviewItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('person_roles')
    .select(PERSON_ROLE_COLUMNS)
    .eq('status', status)
    .order(status === 'submitted' ? 'submitted_at' : 'updated_at', { ascending: status === 'submitted' })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PersonRole[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [rolesRes, evRes, profRes] = await Promise.all([
    admin.from('roles').select(ROLE_COLUMNS),
    admin.from('role_evidence').select(EVIDENCE_COLUMNS).in('person_role_id', ids).order('created_at'),
    admin.from('profiles').select('id, display_name, avatar_url, location, verification_status, verification_metadata').in('id', userIds),
  ]);
  const roles = toRoles(rolesRes.data);
  const evidence = (evRes.data ?? []) as unknown as RoleEvidence[];

  // Short-lived links for private legal documents.
  const docPaths = evidence.filter((e) => e.storage_provider === 'supabase' && e.storage_ref).map((e) => e.storage_ref as string);
  const signed = new Map<string, string>();
  if (docPaths.length) {
    const { data: links } = await admin.storage.from(DOC_BUCKET).createSignedUrls(docPaths, DOC_LINK_SECONDS);
    for (const l of links ?? []) if (l.path && l.signedUrl) signed.set(l.path, l.signedUrl);
  }

  const emails = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (id) => {
      const { data: u } = await admin.auth.admin.getUserById(id);
      emails.set(id, u?.user?.email ?? null);
    }),
  );

  const items: ReviewItem[] = [];
  for (const pr of rows) {
    const role = roles.find((r) => r.slug === pr.role_slug);
    const p = (profRes.data ?? []).find((x) => x.id === pr.user_id);
    if (!role || !p) continue;
    const mine = evidence.filter((e) => e.person_role_id === pr.id);
    const meta = (p.verification_metadata ?? null) as { id_document?: { date_of_birth?: string | null } } | null;
    const identityVerified = p.verification_status === 'verified';
    items.push({
      personRole: pr,
      role,
      person: {
        display_name: (p.display_name as string | null) ?? 'Member',
        avatar_url: (p.avatar_url as string | null) ?? null,
        location: (p.location as string | null) ?? null,
        identityVerified,
        email: emails.get(pr.user_id) ?? null,
      },
      evidence: mine.map((e) => ({
        ...e,
        viewUrl: e.storage_provider === 'supabase' ? (e.storage_ref ? signed.get(e.storage_ref) ?? null : null) : e.url,
      })),
      dateOfBirth: bestDateOfBirth(meta?.id_document?.date_of_birth ?? null, pr.answers?.date_of_birth),
      suggestedLevel: evidenceLevel({
        identityVerified,
        profileApproved: true,
        evidence: toFacts(mine),
        confirmedJobs: confirmedJobCount(toFacts(mine)),
        reviewCount: 0,
        averageRating: 0,
        disputes: 0,
      }).level,
    });
  }
  return items;
}

/** Counts per status, for the admin queue tabs. */
export async function reviewCounts(): Promise<Record<PersonRole['status'], number>> {
  const admin = createAdminClient();
  const out: Record<PersonRole['status'], number> = { draft: 0, submitted: 0, approved: 0, changes_requested: 0 };
  await Promise.all(
    (Object.keys(out) as PersonRole['status'][]).map(async (s) => {
      const { count } = await admin.from('person_roles').select('id', { count: 'exact', head: true }).eq('status', s);
      out[s] = count ?? 0;
    }),
  );
  return out;
}

export { DOC_BUCKET as ROLE_DOCUMENT_BUCKET };
