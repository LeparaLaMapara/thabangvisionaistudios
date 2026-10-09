import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Phase 3 (spec 9.3): photo first, AI pre-fill, a pre-check before Submit,
// declarations at the submit step, and the owner funnel events. Phase 2's
// gates are unchanged; these tests check the new routes keep them.

// ── A minimal stand-in for the Supabase query builder ───────────────────────

interface Result {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}

interface Query {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  payload: unknown;
  eq: Record<string, unknown>;
}

type Resolver = (q: Query) => Result;

class FakeQuery implements PromiseLike<Result> {
  q: Query;
  constructor(table: string, private resolver: Resolver, log: Query[]) {
    this.q = { table, op: 'select', payload: null, eq: {} };
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
  in(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  single(): this { return this; }
  maybeSingle(): this { return this; }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => ({ error: null, count: null, ...this.resolver(this.q) })).then(ok, bad);
  }
}

const state: { resolver: Resolver; log: Query[] } = { resolver: () => ({ data: null }), log: [] };

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: (t: string) => new FakeQuery(t, (q) => state.resolver(q), state.log) }),
  createClient: async () => ({}),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ user: { id: 'owner-1', email: 'o@example.invalid' } }),
  requireAdmin: async () => ({ user: { id: 'admin-1', email: 'a@example.invalid' } }),
  rateLimitAdmin: async () => null,
  checkRateLimit: async () => true,
  checkNotSuspended: async () => ({ suspended: false }),
}));

const fakeStorage = {
  name: 'cloudinary',
  isConfigured: () => true,
  ownsUrl: (url: string) => url.startsWith('https://res.cloudinary.com/ourcloud/'),
  uploadImage: async (_file: string, folder: string) => ({ url: `https://res.cloudinary.com/ourcloud/image/upload/v9/${folder}/copy.jpg`, public_id: `${folder}/copy` }),
  deleteImage: async () => ({ success: true }),
  deleteFolder: async () => ({ success: true }),
  getSignedUploadParams: async () => ({ signature: '', timestamp: '', uploadUrl: '', fields: {} }),
};
vi.mock('@/lib/storage', () => ({ storage: fakeStorage }));

const vision: { result: unknown; fail: boolean; urls: string[] } = { result: null, fail: false, urls: [] };
vi.mock('@/lib/agents/tools', () => ({
  identifyGear: async (url: string) => {
    vision.urls.push(url);
    if (vision.fail) throw new Error('vision down');
    return vision.result;
  },
}));

const describer: { output: unknown } = { output: null };
vi.mock('@/lib/ai/tracked', () => ({ trackedCompletion: async () => describer.output }));

const { POST: SUGGEST } = await import('@/app/api/listings/suggest/route');
const { GET: CHECK } = await import('@/app/api/listings/[id]/check/route');
const { PUT } = await import('@/app/api/listings/route');
const { POST: SUBMIT } = await import('@/app/api/listings/[id]/submit/route');
const { POST: CREATE_RENTALS } = await import('@/app/api/onboarding/create-rentals/route');
const { buildAttestations, precheckSubmission, readAiFields, AI_SUGGESTIBLE_FIELDS } = await import('@/lib/core/listings/review');

// ── Fixtures ────────────────────────────────────────────────────────────────

const A = 'https://res.cloudinary.com/ourcloud/image/upload/q_auto/v1/thabangvision_usecase/media/listings/a.jpg';
const RAW_A = 'https://res.cloudinary.com/ourcloud/image/upload/v1/thabangvision_usecase/media/listings/a.jpg';
const OTHER = 'https://res.cloudinary.com/othercloud/image/upload/v1/x/evil.jpg';
const UPDATED_AT = '2026-10-01T10:00:00.000001+00:00';
const PRIV_AT = '2026-10-01T09:59:00.000002+00:00';

function attested(): unknown {
  const a = buildAttestations({ owns_or_authorised: true, condition_working: true, location_accurate: true }, new Date('2026-10-01T09:00:00Z'));
  if (!a.ok) throw new Error('fixture');
  return a.value;
}

function storedRow(over: Record<string, unknown> = {}, priv: Record<string, unknown> | null = {}): Record<string, unknown> {
  return {
    id: 'r1',
    slug: 'cam-r1',
    title: 'Sony A7 III',
    description: 'Body only',
    category: 'cameras-optics',
    sub_category: 'good',
    brand: 'Sony',
    model: 'A7 III',
    price_per_day: 400,
    price_per_week: 2000,
    deposit_amount: 2000,
    replacement_value: 20000,
    serial_number: null,
    rental_includes: ['Battery'],
    thumbnail_url: A,
    cover_public_id: 'thabangvision_usecase/media/listings/a',
    gallery: [{ url: A, public_id: 'thabangvision_usecase/media/listings/a' }],
    metadata: { location: 'Soweto, Johannesburg' },
    owner_type: 'community',
    owner_id: 'owner-1',
    is_published: false,
    is_ai_generated: false,
    listing_status: 'draft',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: UPDATED_AT,
    deleted_at: null,
    listing_private:
      priv === null
        ? null
        : { ai_fields: null, owner_attestations: attested(), replacement_value_evidence: null, private_updated_at: PRIV_AT, ...priv },
    ...over,
  };
}

interface Facts {
  verification_status?: string;
  bank_verified?: boolean;
  published?: number;
}

function resolver(row: Record<string, unknown>, facts: Facts = {}): Resolver {
  return (q) => {
    if (q.table === 'smart_rentals') {
      if (q.op === 'update') return { data: { id: 'r1' } };
      if (q.op === 'insert') return { data: { id: 'r1' } };
      if (q.op === 'delete') return { data: null };
      if (q.eq.id) return { data: row };
      const n = facts.published ?? 0;
      return { data: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, listing_status: 'published' })), count: n };
    }
    if (q.table === 'listing_private') return q.op === 'update' ? { data: { rental_id: 'r1' } } : { data: null };
    if (q.table === 'profiles') {
      return {
        data: {
          verification_status: facts.verification_status ?? 'verified',
          is_suspended: false,
          suspension_expires_at: null,
          city: 'Soweto',
          province: 'Gauteng',
          location: null,
        },
      };
    }
    if (q.table === 'banking_details') return { data: { is_verified: facts.bank_verified ?? true } };
    if (q.table === 'disputes') return { data: [], count: 0 };
    if (q.table === 'equipment_bookings') return { data: [], count: 0 };
    return { data: null };
  };
}

function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

const suggest = (body: unknown): Promise<Response> => SUGGEST(req('POST', 'http://localhost/api/listings/suggest', body));
const check = (): Promise<Response> => CHECK(req('GET', 'http://localhost/api/listings/r1/check'), { params: Promise.resolve({ id: 'r1' }) });
const put = (body: unknown): Promise<Response> => PUT(req('PUT', 'http://localhost/api/listings', body));
const submit = (): Promise<Response> => SUBMIT(req('POST', 'http://localhost/api/listings/r1/submit'), { params: Promise.resolve({ id: 'r1' }) });

const inserts = (table: string): Record<string, unknown>[] =>
  state.log.filter((q) => q.table === table && q.op === 'insert').map((q) => q.payload as Record<string, unknown>);
const privateWrites = (): Query[] => state.log.filter((q) => q.table === 'listing_private' && q.op !== 'select');
const funnel = (stage: string): Record<string, unknown>[] =>
  inserts('platform_events').filter((e) => e.event_type === `funnel_${stage}`);
const writes = (): string[] => state.log.filter((q) => q.op !== 'select').map((q) => `${q.table}:${q.op}`);

beforeEach(() => {
  state.log = [];
  vision.result = { brand: 'Sony', model: 'A7 III', equipmentType: 'camera body', condition: 'like_new', category: 'cameras-optics', confidence: 92 };
  vision.fail = false;
  vision.urls = [];
  describer.output = { title: 'Sony A7 III body', description: 'Full-frame mirrorless body.', rentalIncludes: ['Body', 'Battery', 'Charger'], suggestedUpsells: [] };
});

// ── POST /api/listings/suggest ──────────────────────────────────────────────

describe('photo first: POST /api/listings/suggest', () => {
  const body = { gallery: [{ url: RAW_A, public_id: 'thabangvision_usecase/media/listings/a' }] };

  it('creates a draft whose every pre-filled field is recorded as AI-suggested', async () => {
    state.resolver = resolver(storedRow());
    const res = await suggest(body);
    expect(res.status).toBe(201);

    const [draft] = inserts('smart_rentals');
    expect(draft.listing_status).toBe('draft');
    expect(draft.is_published).toBe(false);
    expect(draft.owner_type).toBe('community');

    const priv = privateWrites().find((q) => q.op === 'upsert')?.payload as Record<string, unknown>;
    const marked = readAiFields(priv.ai_fields);
    const columnOf: Record<string, string> = { condition: 'sub_category' };
    for (const f of AI_SUGGESTIBLE_FIELDS) {
      const v = draft[columnOf[f] ?? f];
      const isFilled = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined;
      expect({ field: f, marked: marked[f]?.status === 'suggested' }).toEqual({ field: f, marked: isFilled });
    }
    expect(draft.title).toBe('Sony A7 III body');
    expect(draft.sub_category).toBe('like-new');
    expect(draft.price_per_day).toBe(650);
  });

  it('never guesses a replacement value (or a deposit), and takes the location from the profile', async () => {
    state.resolver = resolver(storedRow());
    await suggest(body);
    const [draft] = inserts('smart_rentals');
    expect(draft.replacement_value).toBeNull();
    expect(draft.deposit_amount).toBeNull();
    expect((draft.metadata as Record<string, unknown>).location).toBe('Soweto, Gauteng');
    expect((draft.metadata as Record<string, unknown>).equipment_type).toBe('camera body');
  });

  it('sends the AI the metadata-free photo, not the original upload', async () => {
    state.resolver = resolver(storedRow());
    await suggest(body);
    expect(vision.urls[0]).not.toBe(RAW_A);
    expect(vision.urls[0]).toContain('/image/upload/');
  });

  it('records listing_started with source ai (ids only)', async () => {
    state.resolver = resolver(storedRow());
    await suggest(body);
    const [ev] = funnel('listing_started');
    expect(ev.user_id).toBe('owner-1');
    expect(ev.metadata).toEqual({ listingId: 'r1', source: 'ai' });
  });

  it('refuses photos from anywhere but our storage account, and saves nothing', async () => {
    state.resolver = resolver(storedRow());
    const res = await suggest({ gallery: [{ url: OTHER, public_id: '' }] });
    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
    expect(vision.urls).toEqual([]);
  });

  it('asks for a photo first', async () => {
    state.resolver = resolver(storedRow());
    const res = await suggest({});
    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it('when the gear is not recognised, saves nothing and says so', async () => {
    state.resolver = resolver(storedRow());
    vision.fail = true;
    const res = await suggest(body);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_recognised');
    expect(inserts('smart_rentals')).toEqual([]);
  });

  it('does not ask the describer to write about a low-confidence guess, and says so', async () => {
    state.resolver = resolver(storedRow());
    vision.result = { brand: 'Maybe', model: 'Light', equipmentType: 'light', condition: 'good', category: 'lighting-power', confidence: 30 };
    const res = await suggest(body);
    expect(res.status).toBe(201);
    expect((await res.json()).low_confidence).toBe(true);
    const [draft] = inserts('smart_rentals');
    expect(draft.description).toBeNull();
    expect(draft.title).toBe('Maybe Light');
  });
});

// ── GET /api/listings/[id]/check ────────────────────────────────────────────

describe('pre-check before Submit: GET /api/listings/[id]/check', () => {
  it('lists owner blocks and listing blocks, and writes nothing', async () => {
    state.resolver = resolver(storedRow({ replacement_value: null }, { owner_attestations: null }), {
      verification_status: 'pending',
      bank_verified: false,
    });
    const res = await check();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canSubmit).toBe(false);
    expect(body.outcome).toBeNull();
    expect(body.ownerBlocks.map((b: { code: string }) => b.code)).toEqual(['owner_not_verified', 'payout_not_verified']);
    expect(body.listingBlocks.map((b: { code: string }) => b.code)).toEqual(['missing_replacement_value', 'missing_attestations']);
    expect(body.review.required).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('agrees with submit: a ready listing from a new owner goes to review, with reasons', async () => {
    state.resolver = resolver(storedRow());
    const body = await (await check()).json();
    expect(body.canSubmit).toBe(true);
    expect(body.outcome).toBe('pending_review');
    expect(body.review.reasons.map((r: { code: string }) => r.code)).toContain('first_listing');
  });

  it('shows unconfirmed AI suggestions as a block', async () => {
    state.resolver = resolver(storedRow({}, { ai_fields: { price_per_day: { status: 'suggested', suggested_at: 'x' } } }));
    const body = await (await check()).json();
    expect(body.listingBlocks.map((b: { code: string }) => b.code)).toContain('unconfirmed_ai_fields');
  });

  it('precheckSubmission never says yes when decideSubmission would say no', () => {
    const owner = {
      verificationStatus: 'verified', payoutAccountVerified: true, isSuspended: false, openDisputes: 0,
      publishedListings: 5, rejectedListings: 0, suspendedListings: 0, completedRentals: 9,
    };
    const listing = {
      listing_status: 'published', owner_type: 'community', title: 'x', category: 'audio', price_per_day: 1,
      replacement_value: 10, location: 'Soweto', ai_fields: null, owner_attestations: attested(),
    };
    const p = precheckSubmission(listing, owner);
    expect(p.canSubmit).toBe(false);
    expect(p.statusBlock?.code).toBe('wrong_status');
    expect(precheckSubmission({ ...listing, listing_status: 'draft' }, owner).outcome).toBe('published');
  });
});

// ── Declarations at the submit step ─────────────────────────────────────────

describe("declarations at the submit step: PUT { action: 'attest' }", () => {
  it('stores all three, against the current terms, only on the private row read', async () => {
    state.resolver = resolver(storedRow({}, { owner_attestations: null }));
    const res = await put({ id: 'r1', action: 'attest', attestations: { owns_or_authorised: true, condition_working: true, location_accurate: true } });
    expect(res.status).toBe(200);
    const [w] = privateWrites();
    expect(w.op).toBe('update');
    expect(w.eq.updated_at).toBe(PRIV_AT);
    const stored = (w.payload as Record<string, unknown>).owner_attestations as Record<string, unknown>;
    expect(stored.owns_or_authorised).toBe(true);
    expect(typeof stored.terms_version).toBe('string');
    // Nothing else on the listing changes.
    expect(writes()).toEqual(['listing_private:update']);
  });

  it('refuses fewer than three ticks', async () => {
    state.resolver = resolver(storedRow({}, { owner_attestations: null }));
    const res = await put({ id: 'r1', action: 'attest', attestations: { owns_or_authorised: true } });
    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it('only on a listing that can be submitted', async () => {
    state.resolver = resolver(storedRow({ listing_status: 'published' }));
    const res = await put({ id: 'r1', action: 'attest', attestations: { owns_or_authorised: true, condition_working: true, location_accurate: true } });
    expect(res.status).toBe(409);
    expect(writes()).toEqual([]);
  });
});

// ── Funnel events on submit ─────────────────────────────────────────────────

describe('owner funnel on submit', () => {
  it('records draft complete and submitted (reviewed, with reason codes)', async () => {
    state.resolver = resolver(storedRow());
    const res = await submit();
    expect(res.status).toBe(200);
    expect(funnel('listing_draft_complete')).toHaveLength(1);
    const [sub] = funnel('listing_submitted');
    const meta = sub.metadata as Record<string, unknown>;
    expect(meta.listingId).toBe('r1');
    expect(meta.reviewed).toBe(true);
    expect(meta.codes).toEqual(expect.arrayContaining(['first_listing', 'not_established']));
    expect(funnel('listing_published')).toHaveLength(0);
    expect((await res.json()).review_reason_codes).toContain('first_listing');
  });

  it('records published when an established owner goes live straight away', async () => {
    state.resolver = resolver(storedRow({ replacement_value: 1000 }), { published: 5 });
    // Completed hires come from a head count on equipment_bookings.
    const base = state.resolver;
    state.resolver = (q) => (q.table === 'equipment_bookings' && q.eq.status === 'completed' ? { data: [], count: 9 } : base(q));
    const res = await submit();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('published');
    expect(funnel('listing_published')).toHaveLength(1);
    expect((funnel('listing_submitted')[0].metadata as Record<string, unknown>).reviewed).toBe(false);
  });

  it('a blocked submit with fields missing records neither stage', async () => {
    state.resolver = resolver(storedRow({ replacement_value: null }));
    const res = await submit();
    expect(res.status).toBe(422);
    expect(funnel('listing_draft_complete')).toHaveLength(0);
    expect(funnel('listing_submitted')).toHaveLength(0);
  });

  it('a submit blocked only by the owner checks still counts the draft as complete', async () => {
    state.resolver = resolver(storedRow(), { verification_status: 'pending' });
    const res = await submit();
    expect(res.status).toBe(422);
    expect(funnel('listing_draft_complete')).toHaveLength(1);
    expect(funnel('listing_submitted')).toHaveLength(0);
  });
});

// ── Onboarding gear step ────────────────────────────────────────────────────

describe('onboarding gear: POST /api/onboarding/create-rentals', () => {
  it("uses the owner's edits, keeps low-confidence items, stores condition where the dashboard reads it", async () => {
    state.resolver = resolver(storedRow());
    const items = [
      {
        brand: 'Sony', model: 'A7 III', category: 'cameras-optics', condition: 'like-new', equipmentType: 'camera body',
        confidence: 0.92, thumbnailUrl: A, title: 'My Sony kit', dailyRate: '500',
        ownerEdited: { title: true, category: false, condition: false },
      },
      { brand: 'Maybe', model: 'Light', category: 'lighting-power', condition: 'good', confidence: 0.3, thumbnailUrl: A, title: 'Maybe Light', ownerEdited: {} },
    ];
    const res = await CREATE_RENTALS(req('POST', 'http://localhost/api/onboarding/create-rentals', { items }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toHaveLength(2);
    expect(body.lowConfidence).toBe(1);

    const [sony, unsure] = inserts('smart_rentals');
    expect(sony.title).toBe('My Sony kit');
    expect(sony.price_per_day).toBe(500);
    expect(sony.sub_category).toBe('like-new');
    expect((sony.metadata as Record<string, unknown>).equipment_type).toBe('camera body');
    expect((sony.metadata as Record<string, unknown>).location).toBe('Soweto, Gauteng');
    expect(sony.replacement_value).toBeNull();

    const sonyPriv = readAiFields((privateWrites()[0].payload as Record<string, unknown>).ai_fields);
    expect(sonyPriv.title).toBeUndefined();
    expect(sonyPriv.price_per_day).toBeUndefined();
    expect(sonyPriv.condition?.status).toBe('suggested');
    expect(sonyPriv.price_per_week?.status).toBe('suggested');

    // Not described (a guess), but saved for the owner to finish.
    expect(unsure.description).toBeNull();
    expect(funnel('listing_started').map((e) => (e.metadata as Record<string, unknown>).source)).toEqual(['onboarding', 'onboarding']);
  });
});
