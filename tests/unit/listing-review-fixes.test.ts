import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { LISTING_POLICY } from '@/lib/constants';

// Review follow-ups: cover photo, week rate, submit race, photo copies,
// suspended owners and self-hires.

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
  neq: Record<string, unknown>;
}

type Resolver = (q: Query) => Result;

class FakeQuery implements PromiseLike<Result> {
  q: Query;
  constructor(table: string, private resolver: Resolver, log: Query[]) {
    this.q = { table, op: 'select', payload: null, eq: {}, neq: {} };
    log.push(this.q);
  }
  select(): this { return this; }
  update(payload: unknown): this { this.q.op = 'update'; this.q.payload = payload; return this; }
  insert(payload: unknown): this { this.q.op = 'insert'; this.q.payload = payload; return this; }
  upsert(payload: unknown): this { this.q.op = 'upsert'; this.q.payload = payload; return this; }
  delete(): this { this.q.op = 'delete'; return this; }
  eq(col: string, val: unknown): this { this.q.eq[col] = val; return this; }
  neq(col: string, val: unknown): this { this.q.neq[col] = val; return this; }
  is(): this { return this; }
  not(): this { return this; }
  in(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  single(): this { return this; }
  maybeSingle(): this { return this; }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve({ error: null, count: null, ...this.resolver(this.q) }).then(ok, bad);
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
  checkRateLimit: async () => true,
  checkNotSuspended: async () => (state.suspended ? { suspended: true, reason: 'test' } : { suspended: false }),
}));

// A fake storage provider: "our" account is `ourcloud`.
const uploads: { file: string; folder: string }[] = [];
const deleted: string[] = [];
const storageState = { failUploads: false, configured: true };
const fakeStorage = {
  name: 'cloudinary',
  isConfigured: () => storageState.configured,
  ownsUrl: (url: string) => url.startsWith('https://res.cloudinary.com/ourcloud/'),
  uploadImage: async (file: string, folder: string) => {
    if (storageState.failUploads && uploads.length > 0) throw new Error('upload failed');
    uploads.push({ file, folder });
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

const { parseListingInput, resolveCover } = await import('@/lib/core/listings/input');
const { buildAttestations, editNeedsResubmission, listingBlocks, weekRateProblem } = await import('@/lib/core/listings/review');
const { CLEAN_IMAGE_FOLDER, cleanListingImages, isCleanCopy, metadataFreeImageUrl } = await import('@/app/api/listings/_lib/images');
const { loadOwnerFacts } = await import('@/app/api/listings/_lib/server');
const { PUT } = await import('@/app/api/listings/route');
const { POST: SUBMIT } = await import('@/app/api/listings/[id]/submit/route');

// ── Fixtures ────────────────────────────────────────────────────────────────

const OTHER = 'https://res.cloudinary.com/othercloud/image/upload/v1/x/evil.jpg';
const A = 'https://res.cloudinary.com/ourcloud/image/upload/q_auto/v1/thabangvision_usecase/media/listings/a.jpg';
const B = 'https://res.cloudinary.com/ourcloud/image/upload/q_auto/v1/thabangvision_usecase/media/listings/b.jpg';
const CLEAN = `https://res.cloudinary.com/ourcloud/image/upload/q_auto/v9/${CLEAN_IMAGE_FOLDER}/c1.jpg`;
const UPDATED_AT = '2026-10-01T10:00:00.000001+00:00';

function attested(): unknown {
  const a = buildAttestations({ owns_or_authorised: true, condition_working: true, location_accurate: true }, new Date('2026-10-01T09:00:00Z'));
  if (!a.ok) throw new Error('fixture');
  return a.value;
}

function storedRow(over: Record<string, unknown> = {}, priv: Record<string, unknown> = {}): Record<string, unknown> {
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
    listing_private: { ai_fields: null, owner_attestations: attested(), replacement_value_evidence: null, ...priv },
    ...over,
  };
}

/** The edit body the dashboard would send for storedRow(), with overrides. */
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

function routeResolver(row: Record<string, unknown>, opts: { updateHits?: boolean; facts?: boolean } = {}): Resolver {
  return (q) => {
    if (q.table === 'smart_rentals') {
      if (q.op === 'update') return { data: opts.updateHits === false ? null : { id: 'r1' } };
      if (q.eq.id) return { data: row };
      return { data: [], count: 0 }; // the owner's other listings
    }
    if (q.table === 'listing_private') return { data: null };
    if (q.table === 'profiles') return { data: { verification_status: 'verified', is_suspended: false } };
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
const submit = (): Promise<Response> =>
  SUBMIT(req('POST', 'http://localhost/api/listings/r1/submit'), { params: Promise.resolve({ id: 'r1' }) });

const mainUpdate = (): Query | undefined => state.log.find((q) => q.table === 'smart_rentals' && q.op === 'update');

beforeEach(() => {
  state.log = [];
  state.suspended = false;
  uploads.length = 0;
  deleted.length = 0;
  storageState.failUploads = false;
  storageState.configured = true;
});

// ── 1. Cover photo ──────────────────────────────────────────────────────────

describe('cover photo is one of the listing photos', () => {
  const gallery = [
    { url: A, public_id: 'a' },
    { url: B, public_id: 'b' },
  ];

  it('picks the cover by storage id, then by URL, else the first photo', () => {
    expect(resolveCover(gallery, null, 'b')).toEqual({ ok: true, value: { thumbnail_url: B, cover_public_id: 'b' } });
    expect(resolveCover(gallery, B, null)).toEqual({ ok: true, value: { thumbnail_url: B, cover_public_id: 'b' } });
    expect(resolveCover(gallery, null, null)).toEqual({ ok: true, value: { thumbnail_url: A, cover_public_id: 'a' } });
    expect(resolveCover(null, null, null)).toEqual({ ok: true, value: { thumbnail_url: null, cover_public_id: null } });
  });

  it('refuses a cover that is not one of the photos, from any host', () => {
    expect(resolveCover(gallery, OTHER, null).ok).toBe(false);
    expect(resolveCover(gallery, null, 'someone-elses-id').ok).toBe(false);
    expect(resolveCover(null, OTHER, null).ok).toBe(false);
    const r = parseListingInput({ title: 'Cam', category: 'cameras', gallery, thumbnail_url: OTHER }, { requireCategory: true });
    expect(r).toMatchObject({ ok: false, field: 'thumbnail_url' });
  });

  it('treats cover, condition, week rate and what is included as material on a live listing', () => {
    for (const f of ['thumbnail_url', 'condition', 'price_per_week', 'rental_includes']) {
      expect(editNeedsResubmission('published', [f])).toBe(true);
    }
    expect(editNeedsResubmission('published', ['price_per_day'])).toBe(true);
    expect(editNeedsResubmission('published', ['description'])).toBe(true);
    expect(editNeedsResubmission('published', [])).toBe(false);
  });

  it('PUT: swapping the cover on a live listing takes it back to draft', async () => {
    state.resolver = routeResolver(storedRow());
    const res = await put(editBody({ thumbnail_url: B, cover_public_id: 'thabangvision_usecase/media/listings/b' }));
    expect(res.status).toBe(200);
    const payload = mainUpdate()?.payload as Record<string, unknown>;
    expect(payload.listing_status).toBe('draft');
    expect(payload.thumbnail_url).toBe(B);
    expect(payload.cover_public_id).toBe('thabangvision_usecase/media/listings/b');
  });

  it('PUT: a cover from outside the gallery is refused and nothing is written', async () => {
    state.resolver = routeResolver(storedRow());
    const res = await put(editBody({ thumbnail_url: OTHER, cover_public_id: null }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('thumbnail_url');
    expect(state.log.some((q) => q.op === 'update' || q.op === 'upsert')).toBe(false);
  });

  it('PUT: changing the condition takes a live listing back to draft', async () => {
    state.resolver = routeResolver(storedRow());
    await put(editBody({ condition: 'fair' }));
    expect((mainUpdate()?.payload as Record<string, unknown>).listing_status).toBe('draft');
  });

  it('PUT: a day-rate change takes a live listing back to review, and says why in plain words', async () => {
    state.resolver = routeResolver(storedRow());
    const res = await put(editBody({ price_per_day: 380 }));
    expect((mainUpdate()?.payload as Record<string, unknown>).listing_status).toBe('draft');
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/day rate/);
    expect(JSON.stringify(body)).toMatch(/off the site/);
  });

  it('PUT: a description change takes a live listing back to review', async () => {
    state.resolver = routeResolver(storedRow());
    await put(editBody({ description: 'Call me on 082 000 0000 and pay cash.' }));
    expect((mainUpdate()?.payload as Record<string, unknown>).listing_status).toBe('draft');
  });

  it('PUT: re-saving a live listing unchanged keeps it live', async () => {
    state.resolver = routeResolver(storedRow());
    await put(editBody({}));
    expect('listing_status' in (mainUpdate()?.payload as Record<string, unknown>)).toBe(false);
  });
});

// ── 2. Week rate and what's included are editable ───────────────────────────

describe('week rate', () => {
  it('may not be more than 7 days at the day rate', () => {
    expect(weekRateProblem(400, 2800)).toBeNull();
    expect(weekRateProblem(400, 2800.01)).toMatch(/7 days/);
    expect(weekRateProblem(400, null)).toBeNull();
    expect(weekRateProblem(null, 2000)).toMatch(/day rate/);
  });

  it('parses an editable week rate, keeps "not sent" apart from "cleared"', () => {
    const base = { title: 'Cam', category: 'cameras', price_per_day: 400 };
    const sent = parseListingInput({ ...base, price_per_week: '2000' }, { requireCategory: true });
    expect(sent.ok && sent.value.price_per_week).toBe(2000);
    const notSent = parseListingInput(base, { requireCategory: true });
    expect(notSent.ok && notSent.value.price_per_week).toBeUndefined();
    const cleared = parseListingInput({ ...base, price_per_week: '' }, { requireCategory: true });
    expect(cleared.ok && cleared.value.price_per_week).toBeNull();
    for (const bad of [0, -5, 'abc', 2801]) {
      expect(parseListingInput({ ...base, price_per_week: bad }, { requireCategory: true })).toMatchObject({ ok: false, field: 'price_per_week' });
    }
    const tooMuch = (LISTING_POLICY.maxPricePerDayCents * 7) / 100 + 1;
    expect(parseListingInput({ title: 'Cam', category: 'cameras', price_per_week: tooMuch }, { requireCategory: true }).ok).toBe(false);
  });

  it('parses what is included as a list of short texts', () => {
    const r = parseListingInput({ title: 'Cam', category: 'cameras', rental_includes: [' Battery ', '', 'Battery', 'Charger'] }, { requireCategory: true });
    expect(r.ok && r.value.rental_includes).toEqual(['Battery', 'Charger']);
    expect(parseListingInput({ title: 'Cam', category: 'cameras', rental_includes: 'Battery' }, { requireCategory: true })).toMatchObject({
      ok: false,
      field: 'rental_includes',
    });
    const none = parseListingInput({ title: 'Cam', category: 'cameras' }, { requireCategory: true });
    expect(none.ok && none.value.rental_includes).toBeUndefined();
  });

  it('blocks submission when the stored week rate is above 7 days at the day rate', () => {
    const blocks = listingBlocks({
      listing_status: 'draft',
      owner_type: 'community',
      title: 'Cam',
      category: 'cameras-optics',
      price_per_day: 100,
      price_per_week: 2000,
      replacement_value: 20000,
      location: 'Soweto',
      ai_fields: null,
      owner_attestations: attested(),
    });
    expect(blocks.map((b) => b.code)).toContain('invalid_week_rate');
  });

  it('PUT: the owner can change the AI week rate, which counts as their own value', async () => {
    const now = new Date().toISOString();
    state.resolver = routeResolver(
      storedRow({ listing_status: 'draft', is_published: false }, {
        ai_fields: { price_per_week: { status: 'suggested', suggested_at: now }, rental_includes: { status: 'suggested', suggested_at: now } },
      }),
    );
    const res = await put(editBody({ price_per_week: 1800, rental_includes: ['Battery', 'Charger'] }));
    expect(res.status).toBe(200);
    const payload = mainUpdate()?.payload as Record<string, unknown>;
    expect(payload.price_per_week).toBe(1800);
    expect(payload.rental_includes).toEqual(['Battery', 'Charger']);
    const priv = state.log.find((q) => q.table === 'listing_private' && q.op !== 'select')?.payload as { ai_fields: Record<string, { status: string; confirmed_by?: string }> };
    expect(priv.ai_fields.price_per_week).toMatchObject({ status: 'confirmed', confirmed_by: 'owner_edited' });
    expect(priv.ai_fields.rental_includes).toMatchObject({ status: 'confirmed', confirmed_by: 'owner_edited' });
  });

  it('PUT: lowering the day rate below a seventh of the stored week rate is refused', async () => {
    state.resolver = routeResolver(storedRow());
    const body = editBody({ price_per_day: 200 });
    delete body.price_per_week; // an older client that does not send it
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('price_per_week');
    expect(mainUpdate()).toBeUndefined();
  });

  it('PUT: a body without week rate or includes keeps the stored ones', async () => {
    state.resolver = routeResolver(storedRow());
    const body = editBody();
    delete body.price_per_week;
    delete body.rental_includes;
    await put(body);
    const payload = mainUpdate()?.payload as Record<string, unknown>;
    expect(payload.price_per_week).toBe(2000);
    expect(payload.rental_includes).toEqual(['Battery']);
    expect('listing_status' in payload).toBe(false);
  });
});

// ── 4. Submit race ──────────────────────────────────────────────────────────

describe('submit is guarded by updated_at', () => {
  const draft = (): Record<string, unknown> =>
    storedRow({
      listing_status: 'draft',
      is_published: false,
      gallery: [{ url: CLEAN, public_id: `${CLEAN_IMAGE_FOLDER}/c1` }],
      thumbnail_url: CLEAN,
      cover_public_id: `${CLEAN_IMAGE_FOLDER}/c1`,
    });

  it('updates only if updated_at is still the one it read', async () => {
    state.resolver = routeResolver(draft());
    const res = await submit();
    expect(res.status).toBe(200);
    const u = mainUpdate();
    expect(u?.eq.updated_at).toBe(UPDATED_AT);
    expect(u?.eq.listing_status).toBe('draft');
    expect((u?.payload as Record<string, unknown>).listing_status).toBe('pending_review');
  });

  it('answers 409 when an edit landed meanwhile, and discards photo copies it made', async () => {
    state.resolver = routeResolver(storedRow({ listing_status: 'draft', is_published: false }), { updateHits: false });
    const res = await submit();
    expect(res.status).toBe(409);
    expect(uploads.length).toBe(2);
    expect(deleted.sort()).toEqual([`${CLEAN_IMAGE_FOLDER}/copy1`, `${CLEAN_IMAGE_FOLDER}/copy2`]);
  });

  it('PUT writes the private row first, moves updated_at, and restores the private row on a 409', async () => {
    state.resolver = routeResolver(storedRow(), { updateHits: false });
    const res = await put(editBody({ title: 'Sony A7 III body' }));
    expect(res.status).toBe(409);
    const ops = state.log.filter((q) => q.op !== 'select').map((q) => `${q.table}:${q.op}`);
    // No private row yet: created (insert), then put back only while it is
    // still the version this request wrote (a conditional update).
    expect(ops).toEqual(['listing_private:insert', 'smart_rentals:update', 'listing_private:update']);
    expect(typeof (mainUpdate()?.payload as Record<string, unknown>).updated_at).toBe('string');
    const [written, restore] = state.log.filter((q) => q.table === 'listing_private' && q.op !== 'select');
    expect(restore.eq.updated_at).toBe((written.payload as Record<string, unknown>).updated_at);
    expect((restore.payload as Record<string, unknown>).owner_attestations).toEqual(
      (storedRow().listing_private as Record<string, unknown>).owner_attestations,
    );
  });
});

// ── 5. Photos: metadata-free copies on submit ───────────────────────────────

describe('photo copies', () => {
  it('replaces a transformation that keeps metadata', () => {
    expect(metadataFreeImageUrl('https://res.cloudinary.com/x/image/upload/fl_keep_iptc/v1/a.jpg')).toBe(
      'https://res.cloudinary.com/x/image/upload/q_auto/v1/a.jpg',
    );
  });

  it('recognises only copies in our account whose URL delivers the id they claim', () => {
    expect(isCleanCopy({ url: CLEAN, public_id: `${CLEAN_IMAGE_FOLDER}/c1` }, fakeStorage)).toBe(true);
    expect(isCleanCopy({ url: A, public_id: `${CLEAN_IMAGE_FOLDER}/c1` }, fakeStorage)).toBe(false);
    expect(isCleanCopy({ url: CLEAN.replace('ourcloud', 'othercloud'), public_id: `${CLEAN_IMAGE_FOLDER}/c1` }, fakeStorage)).toBe(false);
    expect(isCleanCopy({ url: A, public_id: 'thabangvision_usecase/media/listings/a' }, fakeStorage)).toBe(false);
  });

  it('copies every photo from its metadata-free delivery and keeps the cover', async () => {
    // Was: a photo from another Cloudinary account was copied too. It is
    // now refused (see "listing photos must be in our account" below).
    const r = await cleanListingImages(
      {
        gallery: [
          { url: A, public_id: 'thabangvision_usecase/media/listings/a' },
          { url: B, public_id: 'thabangvision_usecase/media/listings/b' },
          { url: CLEAN, public_id: `${CLEAN_IMAGE_FOLDER}/c1` },
        ],
        thumbnail_url: B,
        cover_public_id: 'thabangvision_usecase/media/listings/b',
      },
      fakeStorage,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uploads.map((u) => u.file)).toEqual([A, B]);
    expect(uploads.every((u) => u.folder === CLEAN_IMAGE_FOLDER)).toBe(true);
    expect(r.gallery?.map((g) => g.public_id)).toEqual([`${CLEAN_IMAGE_FOLDER}/copy1`, `${CLEAN_IMAGE_FOLDER}/copy2`, `${CLEAN_IMAGE_FOLDER}/c1`]);
    expect(r.cover_public_id).toBe(`${CLEAN_IMAGE_FOLDER}/copy2`);
    expect(r.thumbnail_url).toBe(`https://res.cloudinary.com/ourcloud/image/upload/q_auto/v9/${CLEAN_IMAGE_FOLDER}/copy2.jpg`);
    expect(r.changed).toBe(true);
    expect(r.gallery?.every((g) => isCleanCopy(g, fakeStorage))).toBe(true);
  });

  it('turns a thumbnail-only listing into a one-photo gallery', async () => {
    const r = await cleanListingImages({ gallery: [], thumbnail_url: A, cover_public_id: null }, fakeStorage);
    expect(r.ok && r.gallery?.length).toBe(1);
    expect(r.ok && r.thumbnail_url).toBe(r.ok && r.gallery?.[0].url);
  });

  it('changes nothing when every photo is already a copy', async () => {
    const r = await cleanListingImages(
      { gallery: [{ url: CLEAN, public_id: `${CLEAN_IMAGE_FOLDER}/c1` }], thumbnail_url: CLEAN, cover_public_id: `${CLEAN_IMAGE_FOLDER}/c1` },
      fakeStorage,
    );
    expect(r).toMatchObject({ ok: true, changed: false, uploaded: [] });
    expect(uploads.length).toBe(0);
  });

  it('fails closed: non-Cloudinary photo, storage unavailable, or a failed copy (copies discarded)', async () => {
    expect(await cleanListingImages({ gallery: [{ url: 'https://example.test/a.jpg', public_id: '' }], thumbnail_url: null, cover_public_id: null }, fakeStorage)).toEqual({
      ok: false,
      reason: 'unsupported_image',
    });
    storageState.configured = false;
    expect(await cleanListingImages({ gallery: [{ url: A, public_id: 'a' }], thumbnail_url: null, cover_public_id: null }, fakeStorage)).toEqual({
      ok: false,
      reason: 'storage_unavailable',
    });
    storageState.configured = true;
    storageState.failUploads = true;
    const r = await cleanListingImages(
      { gallery: [{ url: A, public_id: 'a' }, { url: B, public_id: 'b' }], thumbnail_url: null, cover_public_id: null },
      fakeStorage,
    );
    expect(r).toEqual({ ok: false, reason: 'upload_failed' });
    expect(deleted).toEqual([`${CLEAN_IMAGE_FOLDER}/copy1`]);
  });

  it('submit points the listing at the copies in the same guarded update', async () => {
    state.resolver = routeResolver(storedRow({ listing_status: 'draft', is_published: false }));
    const res = await submit();
    expect(res.status).toBe(200);
    const payload = mainUpdate()?.payload as Record<string, unknown>;
    expect((payload.gallery as { public_id: string }[]).map((g) => g.public_id)).toEqual([
      `${CLEAN_IMAGE_FOLDER}/copy1`,
      `${CLEAN_IMAGE_FOLDER}/copy2`,
    ]);
    expect(payload.cover_public_id).toBe(`${CLEAN_IMAGE_FOLDER}/copy1`);
  });

  it('submit answers 503 and changes nothing when photos cannot be copied', async () => {
    storageState.configured = false;
    state.resolver = routeResolver(storedRow({ listing_status: 'draft', is_published: false }));
    const res = await submit();
    expect(res.status).toBe(503);
    expect(mainUpdate()).toBeUndefined();
  });
});

// ── 6. Suspended owners and self-hires ──────────────────────────────────────

describe('suspended owners', () => {
  it('cannot edit or confirm AI fields (403, nothing read or written)', async () => {
    state.suspended = true;
    state.resolver = routeResolver(storedRow());
    const edit = await put(editBody({ title: 'New' }));
    expect(edit.status).toBe(403);
    expect((await edit.json()).code).toBe('owner_suspended');
    expect((await put({ id: 'r1', action: 'confirm_ai_fields', fields: ['title'] })).status).toBe(403);
    expect(state.log.length).toBe(0);
  });

  it('cannot submit', async () => {
    state.suspended = true;
    state.resolver = routeResolver(storedRow({ listing_status: 'draft', is_published: false }));
    expect((await submit()).status).toBe(403);
    expect(mainUpdate()).toBeUndefined();
  });

  it('can still take a live listing down', async () => {
    state.suspended = true;
    state.resolver = routeResolver(storedRow());
    const res = await put({ id: 'r1', action: 'unpublish' });
    expect(res.status).toBe(200);
    expect((mainUpdate()?.payload as Record<string, unknown>).listing_status).toBe('draft');
  });
});

describe('completed hires', () => {
  it('leave out hires where the owner rented their own gear', async () => {
    state.resolver = routeResolver(storedRow());
    const { createAdminClient } = await import('@/lib/supabase/server');
    await loadOwnerFacts(createAdminClient() as unknown as Parameters<typeof loadOwnerFacts>[0], 'owner-1');
    const completed = state.log.find((q) => q.table === 'equipment_bookings' && q.eq.status === 'completed');
    expect(completed?.eq['smart_rentals.owner_id']).toBe('owner-1');
    expect(completed?.neq.user_id).toBe('owner-1');
  });
});
