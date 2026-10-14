import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  blindLabel,
  bestDateOfBirth,
  confirmedJobCount,
  evidenceLevel,
  firstName,
  initials,
  isVerified,
  parseComesWith,
  parseRole,
  PUBLIC_PERSON_ROLE_COLUMNS,
  recordLine,
  reveal,
  sanitizeFacts,
  durationLabel,
  arrivalLabel,
  type ComesWith,
  type EvidenceFact,
  type EvidenceLevel,
  type PersonRole,
  type ProfileFacts,
  type ProfileRecord,
  type Role,
  type RoleEvidence,
  type WhosComing,
  type RequestStatus,
} from '@/lib/roles';

/**
 * Database access for People (migrations 090, 091).
 *
 * EQUAL CHANCE IS ENFORCED HERE. Public reads (anyone, signed in or not)
 * return blind profiles: the role, area, neutral code, work, facts, comes
 * with, price, record and work-only reviews with initials. They never return
 * user_id, a name, a face or the ID-check selfie. Browsers cannot read those
 * columns either (091's column grants). A face and first name leave the
 * server only through getRequestForViewer(), when reveal() allows it.
 *
 * The person's own private columns (answers, reviewer note) are read with
 * the service role after the caller's identity is checked.
 */

export const PERSON_ROLE_COLUMNS =
  `${PUBLIC_PERSON_ROLE_COLUMNS}, user_id, answers, reviewer_note, reviewed_at, facts_source`;

export const EVIDENCE_COLUMNS =
  'id, person_role_id, step_key, kind, source, legal_code, storage_provider, storage_ref, url, is_public, pair_group, pair_side, captured_at, device_summary, note, booking_id, verified_at, is_demo, created_at, media_kind, on_time';

const ROLE_COLUMNS =
  'slug, name, role_group, description, status, min_age, legal_requirements, proof_task, guidelines, pricing_unit, suggested_price_cents, existing_flow_href, sort, proof_format, code_prefix';

export const ROLE_DOCUMENT_BUCKET = 'role-documents';
const VERIFICATION_BUCKET = 'verifications';
const LINK_SECONDS = 15 * 60;

function toRoles(rows: unknown[] | null): Role[] {
  return (rows ?? [])
    .map((r) => parseRole(r as Record<string, unknown>))
    .filter((r): r is Role => r !== null)
    .sort((a, b) => a.sort - b.sort);
}

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

// ─── The person's own data (service role; caller already verified) ──────────

export async function getMyPersonRole(
  userId: string,
  slug: string,
): Promise<{ personRole: PersonRole; evidence: RoleEvidence[] } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('user_id', userId).eq('role_slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const personRole = data as unknown as PersonRole;
  const { data: ev, error: evError } = await admin.from('role_evidence').select(EVIDENCE_COLUMNS).eq('person_role_id', personRole.id).order('created_at');
  if (evError) throw new Error(evError.message);
  return { personRole, evidence: (ev ?? []) as unknown as RoleEvidence[] };
}

/** Every role draft or profile the person has (for the Offer flow). */
export async function getMyPersonRoles(userId: string): Promise<PersonRole[]> {
  const admin = createAdminClient();
  const { data } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('user_id', userId).order('created_at');
  return (data ?? []) as unknown as PersonRole[];
}

export async function getIdentityFacts(
  userId: string,
): Promise<{ identityVerified: boolean; verificationStatus: string | null; dateOfBirthFromId: string | null; hasIdSelfie: boolean }> {
  const admin = createAdminClient();
  const { data } = await admin.from('profiles').select('verification_status, verification_metadata, selfie_with_id_path').eq('id', userId).maybeSingle();
  const meta = (data?.verification_metadata ?? null) as { id_document?: { date_of_birth?: string | null } } | null;
  return {
    identityVerified: data?.verification_status === 'verified',
    verificationStatus: (data?.verification_status as string | null) ?? null,
    dateOfBirthFromId: meta?.id_document?.date_of_birth ?? null,
    hasIdSelfie: !!data?.selfie_with_id_path,
  };
}

export async function getMyFace(userId: string): Promise<{ storage_ref: string; url: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from('person_faces').select('storage_ref').eq('user_id', userId).maybeSingle();
  if (!data) return null;
  return { storage_ref: data.storage_ref as string, url: await faceUrl(data.storage_ref as string) };
}

/** A short-lived link for a face (private bucket), or the demo file path. Server-only. */
async function faceUrl(ref: string): Promise<string | null> {
  if (ref.startsWith('/')) return ref; // demo sample in public/roles/demo
  const admin = createAdminClient();
  const { data } = await admin.storage.from(ROLE_DOCUMENT_BUCKET).createSignedUrl(ref, LINK_SECONDS);
  return data?.signedUrl ?? null;
}

// ─── The record (jobs, on time, reviews, vouches) ───────────────────────────

export interface RecordFacts extends ProfileRecord {
  line: string;
}

function recordFrom(evidence: readonly RoleEvidence[], ratings: number[]): RecordFacts {
  const facts: EvidenceFact[] = evidence.map((e) => ({ kind: e.kind, source: e.source, verified: !!e.verified_at }));
  const jobs = confirmedJobCount(facts);
  const jobRows = evidence.filter((e) => e.kind === 'booking' && e.verified_at);
  const onTimeKnown = jobRows.filter((e) => e.on_time !== null);
  const onTime = onTimeKnown.length === jobRows.length && jobRows.length > 0 ? jobRows.filter((e) => e.on_time).length : null;
  const reviewCount = ratings.length;
  return {
    jobs,
    onTime: onTime ?? 0,
    rebooked: 0,
    reviewCount,
    averageRating: reviewCount ? ratings.reduce((a, b) => a + b, 0) / reviewCount : 0,
    vouches: evidence.filter((e) => e.kind === 'vouch' && e.verified_at).length,
    bookedCredits: [],
    line: recordLine(jobs, onTime),
  };
}

// ─── Blind public profiles ──────────────────────────────────────────────────

export interface PublicReview {
  rating: number;
  comment: string | null;
  initials: string;
  created_at: string;
}

export interface PublicRoleProfile {
  personRole: Pick<PersonRole, 'id' | 'role_slug' | 'headline' | 'about' | 'area' | 'price_cents' | 'per_km_cents' | 'profile_code' | 'available_days' | 'approved_at'>;
  role: Role;
  label: string;
  /** Work proof: never the face. Images, videos and audio by format. */
  work: RoleEvidence[];
  facts: ProfileFacts;
  comesWith: (ComesWith & { photos: RoleEvidence[] }) | null;
  verified: boolean;
  record: RecordFacts;
  reviews: PublicReview[];
}

function publicPart(pr: PersonRole): PublicRoleProfile['personRole'] {
  return {
    id: pr.id,
    role_slug: pr.role_slug,
    headline: pr.headline,
    about: pr.about,
    area: pr.area,
    price_cents: pr.price_cents,
    per_km_cents: pr.per_km_cents,
    profile_code: pr.profile_code,
    available_days: pr.available_days ?? [],
    approved_at: pr.approved_at,
  };
}

async function buildBlind(rows: PersonRole[], roles: Role[], opts: { withReviews: boolean }): Promise<PublicRoleProfile[]> {
  if (!rows.length) return [];
  const admin = createAdminClient();
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [evRes, profRes, revRes] = await Promise.all([
    admin.from('role_evidence').select(EVIDENCE_COLUMNS).in('person_role_id', rows.map((r) => r.id)).order('created_at'),
    admin.from('profiles').select('id, verification_status').in('id', userIds),
    admin.from('reviews').select('reviewee_id, rating, comment, reviewer_name, created_at, is_published').in('reviewee_id', userIds).eq('is_published', true),
  ]);
  const evidence = (evRes.data ?? []) as unknown as RoleEvidence[];
  const out: PublicRoleProfile[] = [];
  for (const pr of rows) {
    const role = roles.find((r) => r.slug === pr.role_slug);
    if (!role) continue;
    const mine = evidence.filter((e) => e.person_role_id === pr.id);
    const reviews = (revRes.data ?? []).filter((r) => r.reviewee_id === pr.user_id);
    const ratings = reviews.map((r) => Number(r.rating)).filter((n) => Number.isFinite(n));
    const work = mine.filter((e) => e.is_public && (e.kind === 'photo' || e.kind === 'video') && e.url && e.step_key !== 'face');
    const comes = parseComesWith(pr.comes_with);
    const identityVerified = (profRes.data ?? []).find((p) => p.id === pr.user_id)?.verification_status === 'verified';
    out.push({
      personRole: publicPart(pr),
      role,
      label: blindLabel(role.name, pr.area, pr.profile_code),
      work,
      facts: sanitizeFacts(pr.facts),
      comesWith: comes ? { ...comes, photos: work.filter((e) => comes.evidenceIds.includes(e.id)) } : null,
      verified: isVerified({ identityVerified, legalVerified: !!pr.legal_verified_at, roleHasLegal: role.legal_requirements.some((r) => r.required) }),
      record: recordFrom(mine, ratings),
      reviews: opts.withReviews
        ? reviews.slice(0, 10).map((r) => ({
            rating: Number(r.rating),
            comment: typeof r.comment === 'string' ? r.comment.slice(0, 500) : null,
            initials: initials(r.reviewer_name as string | null),
            created_at: r.created_at as string,
          }))
        : [],
    });
  }
  return out;
}

/** One approved profile, blind. Null when not approved. */
export async function getPublicRoleProfile(personRoleId: string): Promise<PublicRoleProfile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personRoleId)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('id', personRoleId).eq('status', 'approved').maybeSingle();
  if (!data) return null;
  const roles = await getRoles();
  const [p] = await buildBlind([data as unknown as PersonRole], roles, { withReviews: true });
  return p ?? null;
}

/** The person's own draft, blind, for "Here's how clients will see you". */
export async function getMyPreview(userId: string, slug: string): Promise<PublicRoleProfile | null> {
  const admin = createAdminClient();
  const { data } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('user_id', userId).eq('role_slug', slug).maybeSingle();
  if (!data) return null;
  const pr = data as unknown as PersonRole;
  const roles = await getRoles();
  // A draft's work is not public yet; the preview shows it as it will look.
  const { data: ev } = await admin.from('role_evidence').select(EVIDENCE_COLUMNS).eq('person_role_id', pr.id).order('created_at');
  const evidence = ((ev ?? []) as unknown as RoleEvidence[]).map((e) => ({ ...e, is_public: e.kind !== 'document' && e.kind !== 'vouch' }));
  const role = roles.find((r) => r.slug === slug);
  if (!role) return null;
  const work = evidence.filter((e) => e.is_public && (e.kind === 'photo' || e.kind === 'video') && e.url && e.step_key !== 'face');
  const comes = parseComesWith(pr.comes_with);
  return {
    personRole: publicPart(pr),
    role,
    label: blindLabel(role.name, pr.area, pr.profile_code),
    work,
    facts: sanitizeFacts(pr.facts),
    comesWith: comes ? { ...comes, photos: work.filter((e) => comes.evidenceIds.includes(e.id)) } : null,
    verified: false,
    record: recordFrom(evidence, []),
    reviews: [],
  };
}

export interface ProfileCard {
  id: string;
  roleSlug: string;
  roleName: string;
  label: string;
  headline: string | null;
  cover: string | null;
  priceCents: number | null;
  perKmCents: number | null;
  unit: Role['pricing_unit'];
  verified: boolean;
  record: string;
  comesWith: string | null;
}

/** Approved profiles for People, blind. */
export async function listApprovedProfiles(roleSlug?: string): Promise<ProfileCard[]> {
  const admin = createAdminClient();
  let q = admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('status', 'approved').order('approved_at', { ascending: false }).limit(60);
  if (roleSlug) q = q.eq('role_slug', roleSlug);
  const { data, error } = await q;
  if (error || !data?.length) return [];
  const roles = await getRoles();
  const profiles = await buildBlind(data as unknown as PersonRole[], roles, { withReviews: false });
  return profiles.map((p) => ({
    id: p.personRole.id,
    roleSlug: p.role.slug,
    roleName: p.role.name,
    label: p.label,
    headline: p.personRole.headline,
    cover: p.work.find((e) => e.kind === 'photo')?.url ?? null,
    priceCents: p.personRole.price_cents,
    perKmCents: p.personRole.per_km_cents,
    unit: p.role.pricing_unit,
    verified: p.verified,
    record: p.record.line,
    comesWith: p.comesWith?.label ?? null,
  }));
}

// ─── Booking requests and the reveal ────────────────────────────────────────

export interface RequestInput {
  personRoleId: string;
  clientId: string;
  date: string;
  arrival: string;
  hours: number;
  area: string;
  address: string | null;
  note: string | null;
}

export async function createBookingRequest(i: RequestInput): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('role_booking_requests')
    .insert({
      person_role_id: i.personRoleId,
      client_id: i.clientId,
      requested_date: i.date,
      arrival_time: i.arrival,
      duration_hours: i.hours,
      area: i.area,
      address: i.address,
      note: i.note,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * The "Who's coming" card for one request, as this viewer may see it.
 * The face and first name are fetched ONLY when reveal() says so; for anyone
 * else they are never read, so they cannot leak.
 */
export async function getRequestForViewer(requestId: string, viewerId: string, opts: { staff?: boolean } = {}): Promise<(WhosComing & { viewer: 'client' | 'person'; clientFirstName: string | null; profileId: string }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const admin = createAdminClient();
  const { data: req } = await admin
    .from('role_booking_requests')
    .select('id, person_role_id, client_id, requested_date, arrival_time, duration_hours, area, address, status')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return null;
  const { data: pr } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('id', req.person_role_id).maybeSingle();
  if (!pr) return null;
  const personRole = pr as unknown as PersonRole;
  // Staff (admins) see a request as its client would, so they can check what
  // a client is shown; everyone else outside the booking sees nothing.
  const asViewer = opts.staff && viewerId !== personRole.user_id && viewerId !== req.client_id ? (req.client_id as string) : viewerId;
  const decision = reveal({ status: req.status as RequestStatus, client_id: req.client_id as string, person_user_id: personRole.user_id }, asViewer);
  if (decision.viewer === 'other') return null;

  const roles = await getRoles();
  const [blind] = await buildBlind([personRole], roles, { withReviews: false });
  if (!blind) return null;

  let name: string | null = null;
  let face: string | null = null;
  if (decision.personIdentity) {
    const [{ data: prof }, { data: f }] = await Promise.all([
      admin.from('profiles').select('display_name, first_name').eq('id', personRole.user_id).maybeSingle(),
      admin.from('person_faces').select('storage_ref').eq('user_id', personRole.user_id).maybeSingle(),
    ]);
    name = (prof?.first_name as string | null) || firstName(prof?.display_name as string | null);
    face = f ? await faceUrl(f.storage_ref as string) : null;
  }
  let clientFirst: string | null = null;
  if (decision.clientFirstName) {
    const { data: c } = await admin.from('profiles').select('display_name, first_name').eq('id', req.client_id).maybeSingle();
    clientFirst = (c?.first_name as string | null) || firstName(c?.display_name as string | null);
  }

  return {
    viewer: decision.viewer,
    profileId: personRole.id,
    clientFirstName: clientFirst,
    status: req.status as RequestStatus,
    who: { label: blind.label, roleName: blind.role.name, verified: blind.verified, record: blind.record.line, firstName: name, faceUrl: face },
    where: {
      area: req.area as string,
      address: decision.address ? ((req.address as string | null) ?? null) : null,
      addressNote: decision.viewer === 'client' ? 'Your address is shared with them only after the booking is confirmed.' : decision.address ? 'The address for this job.' : 'The address is shared once the booking is confirmed.',
    },
    when: { date: req.requested_date as string, arrival: arrivalLabel(req.arrival_time as string), duration: durationLabel(Number(req.duration_hours)) },
  };
}

// ─── Admin review (service role; callers must requireAdmin() first) ─────────

export interface ReviewItem {
  personRole: PersonRole;
  role: Role;
  person: { label: string; identityVerified: boolean; email: string | null; displayName: string | null };
  evidence: (RoleEvidence & { viewUrl: string | null })[];
  dateOfBirth: string | null;
  suggestedLevel: EvidenceLevel;
  face: { url: string | null; idSelfieUrl: string | null; check: string | null } | null;
}

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
  const [rolesRes, evRes, profRes, faceRes] = await Promise.all([
    admin.from('roles').select(ROLE_COLUMNS),
    admin.from('role_evidence').select(EVIDENCE_COLUMNS).in('person_role_id', ids).order('created_at'),
    admin.from('profiles').select('id, display_name, verification_status, verification_metadata, selfie_with_id_path').in('id', userIds),
    admin.from('person_faces').select('user_id, storage_ref, face_check').in('user_id', userIds),
  ]);
  const roles = toRoles(rolesRes.data);
  const evidence = (evRes.data ?? []) as unknown as RoleEvidence[];

  const docPaths = evidence.filter((e) => e.storage_provider === 'supabase' && e.storage_ref).map((e) => e.storage_ref as string);
  const signed = new Map<string, string>();
  if (docPaths.length) {
    const { data: links } = await admin.storage.from(ROLE_DOCUMENT_BUCKET).createSignedUrls(docPaths, LINK_SECONDS);
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
    const faceRow = (faceRes.data ?? []).find((f) => f.user_id === pr.user_id);
    let idSelfieUrl: string | null = null;
    if (faceRow && p.selfie_with_id_path) {
      const { data: s } = await admin.storage.from(VERIFICATION_BUCKET).createSignedUrl(p.selfie_with_id_path as string, LINK_SECONDS);
      idSelfieUrl = s?.signedUrl ?? null;
    }
    const facts = mine.map((e) => ({ kind: e.kind, source: e.source, verified: !!e.verified_at }));
    items.push({
      personRole: pr,
      role,
      person: {
        label: blindLabel(role.name, pr.area, pr.profile_code),
        identityVerified,
        email: emails.get(pr.user_id) ?? null,
        displayName: (p.display_name as string | null) ?? null,
      },
      evidence: mine.map((e) => ({
        ...e,
        viewUrl: e.storage_provider === 'supabase' ? (e.storage_ref ? signed.get(e.storage_ref) ?? null : null) : e.url,
      })),
      dateOfBirth: bestDateOfBirth(meta?.id_document?.date_of_birth ?? null, pr.answers?.date_of_birth),
      suggestedLevel: evidenceLevel({ identityVerified, profileApproved: true, evidence: facts, confirmedJobs: confirmedJobCount(facts), reviewCount: 0, averageRating: 0, disputes: 0 }).level,
      face: faceRow ? { url: await faceUrl(faceRow.storage_ref as string), idSelfieUrl, check: (faceRow.face_check as string | null) ?? null } : null,
    });
  }
  return items;
}

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

/** Records for many profiles at once (matching and embeddings). */
export async function loadRecords(rows: Pick<PersonRole, 'id' | 'user_id'>[]): Promise<Map<string, RecordFacts>> {
  const out = new Map<string, RecordFacts>();
  if (!rows.length) return out;
  const admin = createAdminClient();
  const [evRes, revRes] = await Promise.all([
    admin.from('role_evidence').select(EVIDENCE_COLUMNS).in('person_role_id', rows.map((r) => r.id)),
    admin.from('reviews').select('reviewee_id, rating').in('reviewee_id', [...new Set(rows.map((r) => r.user_id))]).eq('is_published', true),
  ]);
  const evidence = (evRes.data ?? []) as unknown as RoleEvidence[];
  for (const r of rows) {
    const ratings = (revRes.data ?? []).filter((x) => x.reviewee_id === r.user_id).map((x) => Number(x.rating)).filter(Number.isFinite);
    out.set(r.id, recordFrom(evidence.filter((e) => e.person_role_id === r.id), ratings));
  }
  return out;
}
