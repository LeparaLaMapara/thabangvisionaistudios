import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── A minimal stand-in for the Supabase query builder ───────────────────────

interface Result {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

interface Query {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  payload: unknown;
  eq: Record<string, unknown>;
  inList: Record<string, unknown[]>;
}

type Resolver = (q: Query) => Result;

class FakeQuery implements PromiseLike<Result> {
  q: Query;
  constructor(table: string, private resolver: Resolver, private log: Query[]) {
    this.q = { table, op: 'select', payload: null, eq: {}, inList: {} };
    log.push(this.q);
  }
  select(): this { return this; }
  update(payload: unknown): this { this.q.op = 'update'; this.q.payload = payload; return this; }
  insert(payload: unknown): this { this.q.op = 'insert'; this.q.payload = payload; return this; }
  upsert(payload: unknown): this { this.q.op = 'upsert'; this.q.payload = payload; return this; }
  delete(): this { this.q.op = 'delete'; return this; }
  eq(col: string, val: unknown): this { this.q.eq[col] = val; return this; }
  neq(): this { return this; }
  is(): this { return this; }
  not(): this { return this; }
  in(col: string, vals: unknown[]): this { this.q.inList[col] = vals; return this; }
  order(): this { return this; }
  limit(): this { return this; }
  single(): this { return this; }
  maybeSingle(): this { return this; }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve({ error: null, count: null, ...this.resolver(this.q) }).then(ok, bad);
  }
}

function fakeAdmin(resolver: Resolver): { client: { from: (t: string) => FakeQuery }; log: Query[] } {
  const log: Query[] = [];
  return { client: { from: (t: string) => new FakeQuery(t, resolver, log) }, log };
}

// ── Module mocks ────────────────────────────────────────────────────────────

const state: { resolver: Resolver; log: Query[] } = { resolver: () => ({ data: null }), log: [] };

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    const f = fakeAdmin((q) => state.resolver(q));
    state.log = f.log;
    return f.client;
  },
  createClient: async () => ({}),
}));

vi.mock('@/lib/auth', () => ({
  requireAdmin: async () => ({ user: { id: 'admin-1', email: 'a@example.invalid' } }),
  rateLimitAdmin: async () => null,
}));

vi.mock('@/lib/rag', () => ({ isRagEnabled: () => false, indexItem: async () => undefined }));

const { loadOwnerFacts, flattenListing, forOwner } = await import('@/app/api/listings/_lib/server');
const { PUT } = await import('@/app/api/admin/rentals/route');
type AdminArg = Parameters<typeof loadOwnerFacts>[0];

// ── Owner facts: disputes from both sources, fail closed ────────────────────

function factsResolver(over: Partial<Record<string, Result>> = {}): Resolver {
  return (q) => {
    if (q.table === 'profiles') return over.profiles ?? { data: { verification_status: 'verified', is_suspended: false } };
    if (q.table === 'banking_details') return over.banking ?? { data: { is_verified: true } };
    if (q.table === 'smart_rentals') return over.listings ?? { data: [{ id: 'l1', listing_status: 'published' }], count: 1 };
    if (q.table === 'disputes') return over.disputes ?? { data: [], count: 0 };
    if (q.table === 'equipment_bookings') {
      if (q.eq.status === 'completed') return over.completed ?? { data: null, count: 7 };
      if (q.eq.status === 'disputed') return over.disputed ?? { data: [], count: 0 };
      return over.disputeBookings ?? { data: [], count: 0 };
    }
    return { data: null };
  };
}

describe('loadOwnerFacts', () => {
  it('counts open disputes from disputed hires and from the disputes table, once per hire', async () => {
    const { client, log } = fakeAdmin(
      factsResolver({
        disputed: { data: [{ id: 'b1' }], count: 1 },
        disputes: { data: [{ equipment_booking_id: 'b1' }, { equipment_booking_id: 'b2' }, { equipment_booking_id: 'other' }], count: 3 },
        // Only b1 and b2 are hires of this owner's gear.
        disputeBookings: { data: [{ id: 'b1' }, { id: 'b2' }], count: 2 },
      }),
    );
    const facts = await loadOwnerFacts(client as unknown as AdminArg, 'owner-1');
    expect(facts.openDisputes).toBe(2);
    expect(facts.completedRentals).toBe(7);
    expect(facts.publishedListings).toBe(1);
    const disputesQuery = log.find((q) => q.table === 'disputes');
    expect(disputesQuery?.inList.status).toEqual(['open', 'investigating', 'escalated']);
  });

  it('fails closed when the disputes lookup errors', async () => {
    const { client } = fakeAdmin(factsResolver({ disputes: { data: null, error: { message: 'boom' } } }));
    await expect(loadOwnerFacts(client as unknown as AdminArg, 'owner-1')).rejects.toThrow(/disputes/);
  });

  it('fails closed when the owner-booking lookup for disputes errors', async () => {
    const { client } = fakeAdmin(
      factsResolver({
        disputes: { data: [{ equipment_booking_id: 'b9' }], count: 1 },
        disputeBookings: { data: null, error: { message: 'boom' } },
      }),
    );
    await expect(loadOwnerFacts(client as unknown as AdminArg, 'owner-1')).rejects.toThrow(/dispute bookings/);
  });

  it('fails closed when a list comes back shorter than its count', async () => {
    const { client } = fakeAdmin(factsResolver({ disputes: { data: [], count: 5000 } }));
    await expect(loadOwnerFacts(client as unknown as AdminArg, 'owner-1')).rejects.toThrow(/5000 rows/);
  });

  it('fails closed when disputed hires cannot be read', async () => {
    const { client } = fakeAdmin(factsResolver({ disputed: { data: null, error: { message: 'boom' } } }));
    await expect(loadOwnerFacts(client as unknown as AdminArg, 'owner-1')).rejects.toThrow(/disputed/);
  });
});

// ── Private fields come from listing_private and are flattened ───────────────

describe('flattenListing / forOwner', () => {
  it('merges the embedded private row and hides the reviewer id from the owner', () => {
    const row = flattenListing({
      id: 'r1',
      title: 'Cam',
      listing_status: 'rejected',
      listing_private: { review_notes: 'Wrong photos', reviewed_by: 'admin-1', ai_fields: { title: { status: 'suggested' } } },
    });
    expect(row.review_notes).toBe('Wrong photos');
    expect(row.owner_attestations).toBeNull();
    expect('listing_private' in row).toBe(false);
    const owner = forOwner(row);
    expect('reviewed_by' in owner).toBe(false);
    expect(owner.review_notes).toBe('Wrong photos');
  });

  it('accepts an array or a missing private row', () => {
    expect(flattenListing({ id: 'r', listing_private: [{ submitted_at: 't' }] }).submitted_at).toBe('t');
    expect(flattenListing({ id: 'r', listing_private: null }).ai_fields).toBeNull();
  });
});

// ── /admin/rentals generic toggle on community rows ─────────────────────────

function put(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/rentals', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('PUT /api/admin/rentals', () => {
  beforeEach(() => {
    state.log = [];
  });

  function rentalResolver(current: { owner_type: string; is_published: boolean }): Resolver {
    return (q) => {
      if (q.op === 'update') return { data: { id: 'r1', ...(q.payload as object) } };
      return { data: current };
    };
  }

  it('refuses to publish a community listing and points to Listing review (409, no write)', async () => {
    state.resolver = rentalResolver({ owner_type: 'community', is_published: false });
    const res = await PUT(put({ id: 'r1', is_published: true }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('use_listing_review');
    expect(body.error).toMatch(/\/admin\/listings/);
    expect(state.log.some((q) => q.op === 'update')).toBe(false);
  });

  it('refuses to unpublish a community listing or set its status directly', async () => {
    state.resolver = rentalResolver({ owner_type: 'community', is_published: true });
    expect((await PUT(put({ id: 'r1', is_published: false }))).status).toBe(409);
    expect((await PUT(put({ id: 'r1', listing_status: 'published' }))).status).toBe(409);
  });

  it('allows other edits to a community listing that leave publishing alone', async () => {
    state.resolver = rentalResolver({ owner_type: 'community', is_published: true });
    const res = await PUT(put({ id: 'r1', is_published: true, is_featured: true }));
    expect(res.status).toBe(200);
  });

  it('keeps the publish toggle for studio gear', async () => {
    state.resolver = rentalResolver({ owner_type: 'studio', is_published: false });
    const res = await PUT(put({ id: 'r1', is_published: true }));
    expect(res.status).toBe(200);
    expect(state.log.find((q) => q.op === 'update')?.payload).toMatchObject({ is_published: true });
  });

  it('404s an unknown rental', async () => {
    state.resolver = () => ({ data: null });
    expect((await PUT(put({ id: 'nope', is_published: true }))).status).toBe(404);
  });
});
