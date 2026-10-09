import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Second review round: what's included as one item per line, the 072
// backfill's private-row guarantee, concurrent edits, photo URLs from our
// own storage account only, and a fail-closed suspension check on edits.

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
  opts: unknown;
  eq: Record<string, unknown>;
}

type Resolver = (q: Query) => Result;

class FakeQuery implements PromiseLike<Result> {
  q: Query;
  constructor(table: string, private resolver: Resolver, log: Query[]) {
    this.q = { table, op: 'select', payload: null, opts: null, eq: {} };
    log.push(this.q);
  }
  select(): this { return this; }
  update(payload: unknown): this { this.q.op = 'update'; this.q.payload = payload; return this; }
  insert(payload: unknown): this { this.q.op = 'insert'; this.q.payload = payload; return this; }
  upsert(payload: unknown, opts?: unknown): this { this.q.op = 'upsert'; this.q.payload = payload; this.q.opts = opts ?? null; return this; }
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
    // Resolved when awaited, so concurrent requests interleave query by query.
    return Promise.resolve().then(() => ({ error: null, count: null, ...this.resolver(this.q) })).then(ok, bad);
  }
}

const state: { resolver: Resolver; log: Query[]; suspended: boolean } = {
  resolver: () => ({ data: null }),
  log: [],
  suspended: false,
};

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: (t: string) => new FakeQuery(t, (q) => state.resolver(q), state.log) }),
  createClient: async () => ({}),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ user: { id: 'owner-1', email: 'o@example.invalid' } }),
  requireAdmin: async () => ({ user: { id: 'admin-1', email: 'a@example.invalid' } }),
  rateLimitAdmin: async () => null,
  checkRateLimit: async () => true,
  // Like the real one when its read fails: "not suspended".
  checkNotSuspended: async () => (state.suspended ? { suspended: true, reason: 'test' } : { suspended: false }),
}));

// "Our" storage account is `ourcloud`. Like the real provider, ownsUrl only
// checks the account prefix; the path shape is checked by the listing code.
const uploads: string[] = [];
const deleted: string[] = [];
const fakeStorage = {
  name: 'cloudinary',
  isConfigured: () => true,
  ownsUrl: (url: string) => url.startsWith('https://res.cloudinary.com/ourcloud/'),
  uploadImage: async (file: string, folder: string) => {
    uploads.push(file);
    const n = uploads.length;
    return { url: `https://res.cloudinary.com/ourcloud/image/upload/v9/${folder}/copy${n}.jpg`, public_id: `${folder}/copy${n}` };
  },
  deleteImage: async (id: string) => {
    deleted.push(id);
    return { success: true };
  },
  deleteFolder: async () => ({ success: true }),
  getSignedUploadParams: async () => ({ signature: '', timestamp: '', uploadUrl: '', fields: {} }),
};
vi.mock('@/lib/storage', () => ({ storage: fakeStorage }));

const describer: { output: unknown } = { output: null };
vi.mock('@/lib/ai/tracked', () => ({ trackedCompletion: async () => describer.output }));

const { parseListingInput, normaliseIncludes, sameIncludes, clampIncludes, includesFromText, includesToText } = await import(
  '@/lib/core/listings/input'
);
const { buildAttestations } = await import('@/lib/core/listings/review');
const { cleanListingImages, isOwnImageUrl, metadataFreeImageUrl } = await import('@/app/api/listings/_lib/images');
const { PUT, POST } = await import('@/app/api/listings/route');
const { POST: SUBMIT } = await import('@/app/api/listings/[id]/submit/route');
const { PATCH: REVIEW } = await import('@/app/api/admin/listings/review/route');
const { POST: CREATE_RENTALS } = await import('@/app/api/onboarding/create-rentals/route');

// ── Fixtures ────────────────────────────────────────────────────────────────

const A = 'https://res.cloudinary.com/ourcloud/image/upload/q_auto/v1/thabangvision_usecase/media/listings/a.jpg';
const B = 'https://res.cloudinary.com/ourcloud/image/upload/q_auto/v1/thabangvision_usecase/media/listings/b.jpg';
const OTHER = 'https://res.cloudinary.com/othercloud/image/upload/v1/x/evil.jpg';
// Our account, but a fetch delivery of someone else's image that merely
// contains "/image/upload/" further down the path.
const FETCH = 'https://res.cloudinary.com/ourcloud/image/fetch/https://evil.example/image/upload/x.jpg';
const OTHER_FETCH = 'https://res.cloudinary.com/othercloud/image/fetch/https://evil.example/image/upload/x.jpg';
const UPDATED_AT = '2026-10-01T10:00:00.000001+00:00';
const PRIV_AT = '2026-10-01T09:59:00.000002+00:00';
const COMMA_ITEM = 'Lens caps (front, rear)';
const LONG_ITEM = `Pelican hard case with custom foam cut-outs for the body, two lenses and four batteries`;

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
    gallery: [
      { url: A, public_id: 'thabangvision_usecase/media/listings/a' },
      { url: B, public_id: 'thabangvision_usecase/media/listings/b' },
    ],
    metadata: { location: 'Soweto, Johannesburg' },
    owner_type: 'community',
    owner_id: 'owner-1',
    is_published: true,
    is_ai_generated: false,
    listing_status: 'published',
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

function editBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r1',
    title: 'Sony A7 III',
    description: 'Body only',
    category: 'cameras-optics',
    condition: 'good',
    brand: 'Sony',
    model: 'A7 III',
    price_per_day: 400,
    price_per_week: 2000,
    replacement_value: 20000,
    rental_includes: ['Battery'],
    location: 'Soweto, Johannesburg',
    thumbnail_url: A,
    cover_public_id: 'thabangvision_usecase/media/listings/a',
    gallery: [
      { url: A, public_id: 'thabangvision_usecase/media/listings/a' },
      { url: B, public_id: 'thabangvision_usecase/media/listings/b' },
    ],
    ...over,
  };
}

interface Over {
  listingUpdate?: Result;
  privateWrite?: (q: Query) => Result;
  profiles?: Result;
}

function routeResolver(row: Record<string, unknown>, over: Over = {}): Resolver {
  return (q) => {
    if (q.table === 'smart_rentals') {
      if (q.op === 'update') return over.listingUpdate ?? { data: { id: 'r1' } };
      if (q.op === 'insert') return { data: { id: 'r1' } };
      if (q.eq.id) return { data: row };
      return { data: [], count: 0 };
    }
    if (q.table === 'listing_private') {
      if (q.op !== 'select' && over.privateWrite) return over.privateWrite(q);
      return q.op === 'update' ? { data: { rental_id: 'r1' } } : { data: null };
    }
    if (q.table === 'profiles') return over.profiles ?? { data: { verification_status: 'verified', is_suspended: false } };
    if (q.table === 'banking_details') return { data: { is_verified: true } };
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

const put = (body: unknown): Promise<Response> => PUT(req('PUT', 'http://localhost/api/listings', body));
const post = (body: unknown): Promise<Response> => POST(req('POST', 'http://localhost/api/listings', body));
const submit = (): Promise<Response> =>
  SUBMIT(req('POST', 'http://localhost/api/listings/r1/submit'), { params: Promise.resolve({ id: 'r1' }) });
const review = (body: unknown): Promise<Response> => REVIEW(req('PATCH', 'http://localhost/api/admin/listings/review', body));

const listingUpdate = (): Query | undefined => state.log.find((q) => q.table === 'smart_rentals' && q.op === 'update');
const privateWrites = (): Query[] => state.log.filter((q) => q.table === 'listing_private' && q.op !== 'select');
const writes = (): string[] => state.log.filter((q) => q.op !== 'select').map((q) => `${q.table}:${q.op}`);

beforeEach(() => {
  state.log = [];
  state.suspended = false;
  uploads.length = 0;
  deleted.length = 0;
  describer.output = null;
});

// ── 1. What's included ──────────────────────────────────────────────────────

describe("what's included: one item per line, stored items never block an edit", () => {
  const base = { title: 'Cam', category: 'cameras' };

  it('the form edits one item per line, so items with commas round-trip unchanged', () => {
    const stored = [COMMA_ITEM, 'Battery', 'Strap, padded'];
    expect(includesFromText(includesToText(stored))).toEqual(stored);
    expect(includesFromText(' Battery \n\n Charger ')).toEqual(['Battery', 'Charger']);
    expect(includesToText(null)).toBe('');
  });

  it('normalises and compares lists (trim, blanks and repeats dropped, order kept)', () => {
    expect(normaliseIncludes([' Battery ', '', 'Battery', COMMA_ITEM])).toEqual(['Battery', COMMA_ITEM]);
    expect(sameIncludes([' Battery', 'Battery', COMMA_ITEM], ['Battery', COMMA_ITEM])).toBe(true);
    expect(sameIncludes(['Battery', COMMA_ITEM], ['Battery', 'Lens caps (front', 'rear)'])).toBe(false);
    expect(sameIncludes(['Battery', 'Charger'], ['Charger', 'Battery'])).toBe(false);
  });

  it('accepts stored items over the length limit and a stored list over the count limit', () => {
    const many = Array.from({ length: 25 }, (_, i) => `Item ${i + 1}`);
    const stored = [LONG_ITEM, ...many];
    const r = parseListingInput({ ...base, rental_includes: stored }, { requireCategory: true, storedIncludes: stored });
    expect(r.ok && r.value.rental_includes).toEqual(stored);
    // Removing one is fine too.
    expect(parseListingInput({ ...base, rental_includes: stored.slice(1) }, { requireCategory: true, storedIncludes: stored }).ok).toBe(true);
  });

  it('still limits what the owner adds', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`);
    expect(parseListingInput({ ...base, rental_includes: [LONG_ITEM] }, { requireCategory: true, storedIncludes: [] })).toMatchObject({
      ok: false,
      field: 'rental_includes',
    });
    expect(parseListingInput({ ...base, rental_includes: [...many, 'One more'] }, { requireCategory: true, storedIncludes: many })).toMatchObject({
      ok: false,
      field: 'rental_includes',
    });
    const longStored = Array.from({ length: 22 }, (_, i) => `Item ${i + 1}`);
    expect(parseListingInput({ ...base, rental_includes: [...longStored, 'One more'] }, { requireCategory: true, storedIncludes: longStored }).ok).toBe(false);
  });

  it('clamps an AI list to what an owner could enter', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
    const out = clampIncludes([LONG_ITEM, ' Battery ', 'Battery', ...many]);
    expect(out.length).toBe(20);
    expect(out[0].length).toBeLessThanOrEqual(80);
    expect(out[1]).toBe('Battery');
    expect(parseListingInput({ ...base, rental_includes: out }, { requireCategory: true }).ok).toBe(true);
  });

  it('PUT: re-saving a live AI listing whose items contain commas changes nothing', async () => {
    const stored = [COMMA_ITEM, 'Battery'];
    const now = new Date().toISOString();
    state.resolver = routeResolver(
      storedRow({ rental_includes: stored }, { ai_fields: { rental_includes: { status: 'suggested', suggested_at: now } } }),
    );
    const res = await put(editBody({ rental_includes: stored }));
    expect(res.status).toBe(200);
    const payload = listingUpdate()?.payload as Record<string, unknown>;
    expect('listing_status' in payload).toBe(false);
    expect(payload.rental_includes).toEqual(stored);
    const priv = privateWrites()[0].payload as { ai_fields: Record<string, { status: string }> };
    expect(priv.ai_fields.rental_includes.status).toBe('suggested');
  });

  it('PUT: a list sent back with whitespace or repeats trimmed keeps the stored list as stored', async () => {
    const stored = [' Battery', 'Battery', 'Charger '];
    state.resolver = routeResolver(storedRow({ rental_includes: stored }));
    const res = await put(editBody({ rental_includes: ['Battery', 'Charger'] }));
    expect(res.status).toBe(200);
    const payload = listingUpdate()?.payload as Record<string, unknown>;
    expect(payload.rental_includes).toEqual(stored);
    expect('listing_status' in payload).toBe(false);
  });

  it('PUT: a stored list over the limits (long item, 25 items) can be re-saved', async () => {
    const stored = [LONG_ITEM, ...Array.from({ length: 24 }, (_, i) => `Item ${i + 1}`)];
    state.resolver = routeResolver(storedRow({ rental_includes: stored }));
    const res = await put(editBody({ rental_includes: stored, title: 'Sony A7 III body' }));
    expect(res.status).toBe(200);
    expect((listingUpdate()?.payload as Record<string, unknown>).rental_includes).toEqual(stored);
  });

  it('PUT: a real change to what is included still takes a live listing back to draft', async () => {
    state.resolver = routeResolver(storedRow({ rental_includes: [COMMA_ITEM] }));
    await put(editBody({ rental_includes: [COMMA_ITEM, 'Strap'] }));
    expect((listingUpdate()?.payload as Record<string, unknown>).listing_status).toBe('draft');
  });

  it('onboarding drafts store a clamped list and only photos from our account', async () => {
    describer.output = {
      title: 'Sony A7 III',
      description: 'A body.',
      rentalIncludes: [LONG_ITEM, ...Array.from({ length: 25 }, (_, i) => `Item ${i + 1}`)],
      suggestedUpsells: [],
    };
    state.resolver = routeResolver(storedRow());
    const items = [
      { brand: 'Sony', model: 'A7 III', category: 'cameras-optics', confidence: 0.9, thumbnailUrl: A },
      { brand: 'Canon', model: 'R5', category: 'cameras-optics', confidence: 0.9, thumbnailUrl: OTHER },
      { brand: 'Nikon', model: 'Z6', category: 'cameras-optics', confidence: 0.9, thumbnailUrl: FETCH },
    ];
    const res = await CREATE_RENTALS(req('POST', 'http://localhost/api/onboarding/create-rentals', { items }));
    expect(res.status).toBe(200);
    const inserts = state.log.filter((q) => q.table === 'smart_rentals' && q.op === 'insert').map((q) => q.payload as Record<string, unknown>);
    expect(inserts.length).toBe(3);
    for (const p of inserts) {
      const list = p.rental_includes as string[];
      expect(list.length).toBe(20);
      expect(list.every((i) => i.length <= 80)).toBe(true);
    }
    expect(inserts[0].thumbnail_url).toBe(A);
    expect(inserts[1].thumbnail_url).toBeNull();
    expect(inserts[1].gallery).toEqual([]);
    expect(inserts[2].thumbnail_url).toBeNull();
  });
});

// ── 2. Every listing that goes live has a private row first ─────────────────

describe('a listing that goes live always has its private row (072 backfill relies on it)', () => {
  const draft = (): Record<string, unknown> => storedRow({ listing_status: 'draft', is_published: false });

  it('submit: submitted_at is written before the guarded status update', async () => {
    state.resolver = routeResolver(draft());
    const res = await submit();
    expect(res.status).toBe(200);
    const w = writes();
    expect(w.indexOf('listing_private:upsert')).toBeGreaterThanOrEqual(0);
    expect(w.indexOf('listing_private:upsert')).toBeLessThan(w.indexOf('smart_rentals:update'));
    expect((privateWrites()[0].payload as Record<string, unknown>).submitted_at).toEqual(expect.any(String));
  });

  it('submit: if submitted_at cannot be written, nothing goes live and photo copies are discarded (503)', async () => {
    state.resolver = routeResolver(draft(), { privateWrite: () => ({ data: null, error: { message: 'down' } }) });
    const res = await submit();
    expect(res.status).toBe(503);
    expect(listingUpdate()).toBeUndefined();
    expect(uploads.length).toBe(2);
    expect(deleted.length).toBe(2);
  });

  const pending = (priv: Record<string, unknown> | null): Record<string, unknown> =>
    storedRow({ listing_status: 'pending_review', is_published: false }, priv);

  it('neither submit nor approve can publish a listing that has no private row', async () => {
    // No private row means no owner declarations, which both require.
    state.resolver = routeResolver(storedRow({ listing_status: 'draft', is_published: false }, null));
    const s = await submit();
    expect(s.status).toBe(422);
    expect((await s.json()).reasons.map((r: { code: string }) => r.code)).toContain('missing_attestations');

    state.log = [];
    state.resolver = routeResolver(pending(null));
    const a = await review({ id: 'r1', action: 'approve' });
    expect(a.status).toBe(422);
    expect(listingUpdate()).toBeUndefined();
  });

  it('approve: the decision is made before the review record is written', async () => {
    state.resolver = routeResolver(pending({}));
    const res = await review({ id: 'r1', action: 'approve' });
    expect(res.status).toBe(200);
    expect(writes().slice(0, 2)).toEqual(['smart_rentals:update', 'listing_private:upsert']);
  });

  it('approve: the review record is retried once, then reported, never undoing the decision', async () => {
    let calls = 0;
    state.resolver = routeResolver(pending({}), {
      privateWrite: () => {
        calls += 1;
        return calls === 1 ? { data: null, error: { message: 'blip' } } : { data: null };
      },
    });
    const ok = await review({ id: 'r1', action: 'approve' });
    expect(ok.status).toBe(200);
    expect(calls).toBe(2);
    expect((await ok.json()).warning).toBeUndefined();

    state.log = [];
    state.resolver = routeResolver(pending({}), { privateWrite: () => ({ data: null, error: { message: 'down' } }) });
    const warned = await review({ id: 'r1', action: 'approve' });
    expect(warned.status).toBe(200);
    expect(privateWrites().length).toBe(2);
    expect((await warned.json()).warning).toMatch(/not recorded/);
  });
});

// ── 3. Concurrent edits ─────────────────────────────────────────────────────

describe('edits are conditional on what the request read', () => {
  it('PUT: the listing update is guarded by status and updated_at', async () => {
    state.resolver = routeResolver(storedRow());
    await put(editBody({ price_per_day: 380 }));
    const u = listingUpdate();
    expect(u?.eq.updated_at).toBe(UPDATED_AT);
    expect(u?.eq.listing_status).toBe('published');
  });

  it('PUT: the private write is guarded by the private version read; a miss is 409 with nothing else written', async () => {
    state.resolver = routeResolver(storedRow(), { privateWrite: () => ({ data: null }) });
    const res = await put(editBody({ title: 'Sony A7 III body' }));
    expect(res.status).toBe(409);
    expect(privateWrites().length).toBe(1);
    expect(privateWrites()[0].op).toBe('update');
    expect(privateWrites()[0].eq.updated_at).toBe(PRIV_AT);
    expect(listingUpdate()).toBeUndefined();
  });

  it('PUT: with no private row yet, a row created meanwhile is a 409', async () => {
    state.resolver = routeResolver(storedRow({}, null), {
      privateWrite: () => ({ data: null, error: { message: 'duplicate key', code: '23505' } }),
    });
    const res = await put(editBody({ title: 'Sony A7 III body' }));
    expect(res.status).toBe(409);
    expect(privateWrites()[0].op).toBe('insert');
    expect(listingUpdate()).toBeUndefined();
  });

  it('PUT: on a lost listing update, the private row is put back only if it still holds this write', async () => {
    let n = 0;
    state.resolver = routeResolver(storedRow(), {
      listingUpdate: { data: null },
      // First write lands; the restore finds someone else's version.
      privateWrite: () => ((n += 1) === 1 ? { data: { rental_id: 'r1' } } : { data: null }),
    });
    const res = await put(editBody({ title: 'Sony A7 III body' }));
    expect(res.status).toBe(409);
    const [written, restore] = privateWrites();
    expect(restore.op).toBe('update');
    expect(restore.eq.updated_at).toBe((written.payload as Record<string, unknown>).updated_at);
    expect(privateWrites().length).toBe(2);
  });

  it('confirm_ai_fields is guarded by the private version too', async () => {
    const now = new Date().toISOString();
    state.resolver = routeResolver(storedRow({}, { ai_fields: { title: { status: 'suggested', suggested_at: now } } }), {
      privateWrite: () => ({ data: null }),
    });
    const res = await put({ id: 'r1', action: 'confirm_ai_fields', fields: ['title'] });
    expect(res.status).toBe(409);
    expect(privateWrites()[0].eq.updated_at).toBe(PRIV_AT);
  });

  it('two concurrent edits: one wins whole, the other changes nothing, and AI markers survive', async () => {
    // A tiny in-memory store with the same compare-and-set rules as the database.
    const db: { rental: Record<string, unknown>; priv: Record<string, unknown> | null } = {
      rental: (() => {
        const r = storedRow({ listing_status: 'draft', is_published: false });
        delete r.listing_private;
        return r;
      })(),
      priv: { rental_id: 'r1', ai_fields: null, owner_attestations: attested(), replacement_value_evidence: null, updated_at: PRIV_AT },
    };
    let tick = 0;
    const matches = (row: Record<string, unknown>, eq: Record<string, unknown>): boolean =>
      Object.entries(eq).every(([k, v]) => row[k] === v);
    state.resolver = (q) => {
      if (q.table === 'profiles') return { data: { is_suspended: false } };
      if (q.table === 'smart_rentals' && q.op === 'select') {
        const { updated_at: privAt, ...priv } = db.priv ?? {};
        return { data: { ...db.rental, listing_private: db.priv ? { ...priv, private_updated_at: privAt } : null } };
      }
      if (q.table === 'smart_rentals' && q.op === 'update') {
        if (!matches(db.rental, q.eq)) return { data: null };
        db.rental = { ...db.rental, ...(q.payload as object), updated_at: `2026-10-02T00:00:0${(tick += 1)}+00:00` };
        return { data: { id: 'r1' } };
      }
      if (q.table === 'listing_private' && q.op === 'update') {
        if (!db.priv || !matches(db.priv, q.eq)) return { data: null };
        db.priv = { ...db.priv, ...(q.payload as object) };
        return { data: { rental_id: 'r1' } };
      }
      if (q.table === 'listing_private' && q.op === 'insert') {
        if (db.priv) return { data: null, error: { message: 'duplicate', code: '23505' } };
        db.priv = { ...(q.payload as object) };
        return { data: null };
      }
      if (q.table === 'listing_private' && q.op === 'upsert') {
        db.priv = { ...(db.priv ?? {}), ...(q.payload as object) };
        return { data: null };
      }
      return { data: null };
    };

    // A: the AI rewrote the description (marked suggested). B: a title edit.
    const [a, b] = await Promise.all([
      put(editBody({ description: 'AI words', ai_suggested_fields: ['description'] })),
      put(editBody({ title: 'Sony A7 III body' })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const aiFields = (db.priv?.ai_fields ?? null) as Record<string, { status: string }> | null;
    if (a.status === 200) {
      expect(db.rental.description).toBe('AI words');
      expect(db.rental.title).toBe('Sony A7 III');
      expect(aiFields?.description?.status).toBe('suggested');
    } else {
      expect(db.rental.title).toBe('Sony A7 III body');
      expect(db.rental.description).toBe('Body only');
      expect(aiFields?.description).toBeUndefined();
    }
  });
});

// ── 4. Photos: our storage account only ─────────────────────────────────────

describe('listing photos must be in our account', () => {
  it('isOwnImageUrl needs our account AND a path starting /<cloud>/image/upload/', () => {
    expect(isOwnImageUrl(A, fakeStorage)).toBe(true);
    expect(isOwnImageUrl(OTHER, fakeStorage)).toBe(false);
    expect(isOwnImageUrl(FETCH, fakeStorage)).toBe(false);
    expect(isOwnImageUrl(OTHER_FETCH, fakeStorage)).toBe(false);
    expect(isOwnImageUrl('https://res.cloudinary.com/ourcloud/video/upload/v1/a.mp4', fakeStorage)).toBe(false);
    expect(isOwnImageUrl('https://example.test/ourcloud/image/upload/v1/a.jpg', fakeStorage)).toBe(false);
  });

  it('a fetch delivery is not rewritten as if it were an upload', () => {
    expect(metadataFreeImageUrl(FETCH)).toBe(FETCH);
  });

  it('submit copies refuse other accounts and fetch deliveries (nothing uploaded)', async () => {
    for (const url of [OTHER, FETCH, OTHER_FETCH]) {
      const r = await cleanListingImages({ gallery: [{ url, public_id: 'x' }], thumbnail_url: null, cover_public_id: null }, fakeStorage);
      expect(r).toEqual({ ok: false, reason: 'unsupported_image' });
    }
    expect(uploads.length).toBe(0);
  });

  it('submit: a stored photo from elsewhere answers 422 (upload again), nothing copied or published', async () => {
    state.resolver = routeResolver(
      storedRow({ listing_status: 'draft', is_published: false, gallery: [{ url: FETCH, public_id: '' }], thumbnail_url: FETCH, cover_public_id: null }),
    );
    const res = await submit();
    expect(res.status).toBe(422);
    expect((await res.json()).reasons[0].code).toBe('unsupported_image');
    expect(uploads.length).toBe(0);
    expect(listingUpdate()).toBeUndefined();
  });

  it('POST: a photo from another account or a fetch URL is refused', async () => {
    for (const url of [OTHER, FETCH]) {
      state.log = [];
      state.resolver = routeResolver(storedRow());
      const res = await post({ title: 'Cam', category: 'cameras', gallery: [{ url, public_id: '' }] });
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe('gallery');
      expect(writes()).toEqual([]);
    }
  });

  it('PUT: a new photo from elsewhere is refused; photos already on the listing may stay', async () => {
    state.resolver = routeResolver(storedRow());
    const bad = await put(editBody({ gallery: [{ url: A, public_id: 'a' }, { url: FETCH, public_id: '' }] }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe('gallery');

    // A listing saved before this check, with a foreign photo: still editable.
    state.log = [];
    const legacy = storedRow({ gallery: [{ url: OTHER, public_id: '' }], thumbnail_url: OTHER, cover_public_id: null });
    state.resolver = routeResolver(legacy);
    const ok = await put(editBody({ gallery: [{ url: OTHER, public_id: '' }], thumbnail_url: OTHER, cover_public_id: null, price_per_day: 380 }));
    expect(ok.status).toBe(200);
  });
});

// ── 5. Suspension check on edits fails closed ───────────────────────────────

describe('suspended owner check on PUT fails closed', () => {
  it('a failed read answers 503 and reads or writes no listing', async () => {
    state.resolver = routeResolver(storedRow(), { profiles: { data: null, error: { message: 'db down' } } });
    const res = await put(editBody({ title: 'New' }));
    expect(res.status).toBe(503);
    expect(state.log.some((q) => q.table === 'smart_rentals' || q.table === 'listing_private')).toBe(false);
    const confirm = await put({ id: 'r1', action: 'confirm_ai_fields', fields: ['title'] });
    expect(confirm.status).toBe(503);
  });

  it('a suspension the session check missed is still a 403', async () => {
    state.resolver = routeResolver(storedRow(), { profiles: { data: { is_suspended: true, suspension_expires_at: null } } });
    const res = await put(editBody({ title: 'New' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('owner_suspended');
    expect(listingUpdate()).toBeUndefined();
  });

  it('an expired suspension does not block', async () => {
    state.resolver = routeResolver(storedRow(), { profiles: { data: { is_suspended: true, suspension_expires_at: '2020-01-01T00:00:00Z' } } });
    expect((await put(editBody({ price_per_day: 380 }))).status).toBe(200);
  });

  it('taking a listing down does not depend on the check', async () => {
    state.resolver = routeResolver(storedRow(), { profiles: { data: null, error: { message: 'db down' } } });
    const res = await put({ id: 'r1', action: 'unpublish' });
    expect(res.status).toBe(200);
  });
});

describe('an item with a newline inside it survives the one-per-line editor', () => {
  it('round-trips as unchanged', async () => {
    const { includesToText, includesFromText, sameIncludes } = await import('@/lib/core/listings/input');
    const stored = ['Battery\ncharger', 'Lens caps (front, rear)'];
    expect(sameIncludes(stored, includesFromText(includesToText(stored)))).toBe(true);
  });
});
