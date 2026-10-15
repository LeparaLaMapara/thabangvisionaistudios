import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findIdentityFields } from '@/lib/roles';

/**
 * Equal chance, enforced in data access: what the People pages are given
 * for unbooked viewers never contains a face or a name, even though the
 * database rows the server reads do (user_id, display_name, faces).
 */

const reads: string[] = [];

const ROLE = {
  slug: 'makeup-artist', name: 'Make-up artist', role_group: 'hair_makeup', description: 'Make-up.', status: 'live', min_age: null,
  legal_requirements: [], proof_task: [], guidelines: 'g', pricing_unit: 'look', suggested_price_cents: { typical: 65000, low: 35000, high: 150000 },
  existing_flow_href: null, sort: 20, proof_format: 'look', code_prefix: 'MA',
};
const PR = {
  id: '00000000-0000-4000-9000-000000000001', user_id: 'u-thandi', role_slug: 'makeup-artist', status: 'approved', evidence_level: 'shown',
  headline: 'Soft glam', about: null, area: 'Soweto', price_cents: 55000, per_km_cents: null, answers: { date_of_birth: '1998-01-01' },
  reviewer_note: null, legal_verified_at: null, approved_at: '2026-10-01', is_demo: true, profile_code: 'MA-1001', facts: {}, comes_with: {}, available_days: ['sat'],
};
const DATA: Record<string, unknown[]> = {
  roles: [ROLE],
  person_roles: [PR],
  role_evidence: [{ id: 'e1', person_role_id: PR.id, step_key: 'work', kind: 'photo', source: 'captured_in_app', is_public: true, url: '/roles/demo/look-1.svg', media_kind: 'image', verified_at: null, on_time: null }],
  profiles: [{ id: 'u-thandi', display_name: 'Thandi Mokoena', first_name: 'Thandi', verification_status: 'verified' }],
  reviews: [{ reviewee_id: 'u-thandi', rating: 5, comment: 'Lovely work', reviewer_name: 'Lerato Dube', created_at: '2026-10-02', is_published: true }],
  person_faces: [{ user_id: 'u-thandi', storage_ref: '/roles/demo/face.svg' }],
  role_booking_requests: [{ id: '00000000-0000-4000-8000-0000000000aa', person_role_id: PR.id, client_id: 'client-1', requested_date: '2026-11-01', arrival_time: '08:00:00', duration_hours: 4, area: 'Soweto', address: '1 Secret Road', status: 'requested' }],
};

function builder(table: string) {
  reads.push(table);
  const rows = DATA[table] ?? [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'is']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  b.single = async () => ({ data: rows[0] ?? null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return b;
}

vi.mock('@/lib/supabase/server', () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: (t: string) => builder(t),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/face' } }) }) },
  };
  return { createClient: async () => client, createAdminClient: () => client };
});

describe('blind data access', () => {
  beforeEach(() => {
    reads.length = 0;
  });

  it('People cards carry no face, no name, no user id', async () => {
    const { listApprovedProfiles } = await import('@/lib/supabase/queries/roles');
    const cards = await listApprovedProfiles();
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe('Make-up artist in Soweto');
    expect(findIdentityFields(cards)).toEqual([]);
    expect(JSON.stringify(cards)).not.toMatch(/Thandi|Mokoena|u-thandi|face\.svg|1998/);
    expect(reads).not.toContain('person_faces');
  });

  it('a profile carries no identity; reviews show initials only', async () => {
    const { getPublicRoleProfile } = await import('@/lib/supabase/queries/roles');
    const p = await getPublicRoleProfile(PR.id);
    expect(p).not.toBeNull();
    expect(findIdentityFields(p)).toEqual([]);
    expect(JSON.stringify(p)).not.toMatch(/Thandi|Mokoena|u-thandi|face\.svg|Lerato|Dube|1998/);
    expect(p?.reviews[0].initials).toBe('L.D.');
    expect(reads).not.toContain('person_faces');
  });

  it('a request that is not confirmed reveals nothing, and the face is never read', async () => {
    const { getRequestForViewer } = await import('@/lib/supabase/queries/roles');
    const card = await getRequestForViewer('00000000-0000-4000-8000-0000000000aa', 'client-1');
    expect(card?.who.faceUrl).toBeNull();
    expect(card?.who.firstName).toBeNull();
    expect(card?.where.address).toBeNull();
    expect(reads).not.toContain('person_faces');
  });

  it('once confirmed, the client sees the face and first name', async () => {
    (DATA.role_booking_requests[0] as { status: string }).status = 'confirmed';
    const { getRequestForViewer } = await import('@/lib/supabase/queries/roles');
    const card = await getRequestForViewer('00000000-0000-4000-8000-0000000000aa', 'client-1');
    expect(card?.who.firstName).toBe('Thandi');
    expect(card?.who.faceUrl).toBe('/roles/demo/face.svg');
    expect(card?.where.address).toBeNull(); // the address is for the booked person
    const stranger = await getRequestForViewer('00000000-0000-4000-8000-0000000000aa', 'someone-else');
    expect(stranger).toBeNull();
    // Staff see it as the client would (to check what clients are shown).
    const staff = await getRequestForViewer('00000000-0000-4000-8000-0000000000aa', 'admin-1', { staff: true });
    expect(staff?.viewer).toBe('client');
    expect(staff?.who.firstName).toBe('Thandi');
  });
});
