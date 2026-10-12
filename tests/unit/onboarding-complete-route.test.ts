import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The last onboarding step returned 500 for every creator: the production
 * row was written with a submitted_at column that exists on neither database,
 * and the profile had already been marked onboarded, so the creator was
 * recorded as finished, stuck, and never sent to the ID check.
 */

type Row = Record<string, unknown>;
type Call = { table: string; op: string; payload?: Row };
const calls: Call[] = [];
const state = {
  liveProduction: false,
  /** Error codes the next inserts into smart_productions return, in order. */
  insertErrors: [] as Array<{ code?: string; message: string } | null>,
  productionUpdateError: null as { message: string } | null,
  verificationStatus: 'unverified',
  user: { id: 'creator-1' } as { id: string } | null,
};

/** Columns smart_productions really has (dev and prod, 2026-10-12). */
const PRODUCTION_COLUMNS = new Set([
  'id', 'slug', 'title', 'client', 'year', 'project_type', 'sub_category', 'description', 'video_provider',
  'video_url', 'tags', 'thumbnail_url', 'cover_public_id', 'gallery', 'is_published', 'is_featured',
  'created_at', 'updated_at', 'deleted_at', 'image_metadata', 'crew_ids', 'production_category_id', 'price',
  'currency', 'creator_id', 'price_unit',
]);

function builder(table: string) {
  const call: Call = { table, op: 'select' };
  const b: Record<string, unknown> = {};
  const finish = () => {
    calls.push(call);
    if (table === 'smart_productions' && call.op === 'update') {
      if (state.productionUpdateError) return { data: null, error: state.productionUpdateError };
      return { data: state.liveProduction ? [{ id: 'p1' }] : [], error: null };
    }
    if (table === 'profiles' && call.op === 'update') {
      return { data: { verification_status: state.verificationStatus }, error: null };
    }
    return { data: null, error: null };
  };
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    is: () => b,
    update: (p: Row) => { call.op = 'update'; call.payload = p; return b; },
    insert: (p: Row) => {
      call.op = 'insert'; call.payload = p; calls.push(call);
      const err = state.insertErrors.shift() ?? null;
      return Promise.resolve({ error: err });
    },
    upsert: () => { throw new Error('no upsert: creator_id has no unique index'); },
    single: async () => {
      calls.push(call);
      return {
        data: { id: 'creator-1abcdef', display_name: 'Cebo', crew_slug: 'cebo', bio: 'Bio', specializations: ['photography'], skills: ['Photography'], hourly_rate: 900, portfolio_projects: [], crew_featured: false },
        error: null,
      };
    },
    maybeSingle: async () => finish(),
    then: (res: (v: unknown) => unknown) => Promise.resolve(finish()).then(res),
  });
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: (t: string) => builder(t) }),
  createClient: async () => ({
    from: (t: string) => builder(t),
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

const { POST } = await import('@/app/api/onboarding/complete/route');
const call = (body: unknown = {}) =>
  POST(new Request('http://localhost/api/onboarding/complete', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  calls.length = 0;
  state.liveProduction = false;
  state.insertErrors = [];
  state.productionUpdateError = null;
  state.verificationStatus = 'unverified';
  state.user = { id: 'creator-1' };
});

const profileUpdates = () => calls.filter((c) => c.table === 'profiles' && c.op === 'update');
const productionWrites = () => calls.filter((c) => c.table === 'smart_productions' && (c.op === 'insert' || c.op === 'update'));

describe('POST /api/onboarding/complete', () => {
  it('saves the production with only real columns, then marks onboarded and sends to the ID check', async () => {
    const res = await call({ draftedGear: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, next: '/dashboard/verification?from=onboarding&drafted=1' });

    for (const w of productionWrites()) {
      for (const key of Object.keys(w.payload ?? {})) expect(PRODUCTION_COLUMNS.has(key)).toBe(true);
      expect(w.payload).not.toHaveProperty('submitted_at');
    }
    // The profile is written after the production, not before.
    const order = calls.filter((c) => c.op === 'update' || c.op === 'insert').map((c) => c.table);
    expect(order.indexOf('profiles')).toBeGreaterThan(order.lastIndexOf('smart_productions'));
    expect(profileUpdates()[0].payload).toHaveProperty('onboarding_completed_at');
  });

  it('a failed production write leaves the profile NOT onboarded', async () => {
    state.insertErrors = [{ code: '42703', message: 'column does not exist' }];
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/try again/i);
    expect(profileUpdates()).toHaveLength(0);
  });

  it('updates the existing production instead of inserting a second one', async () => {
    state.liveProduction = true;
    expect((await call()).status).toBe(200);
    expect(productionWrites().map((c) => c.op)).toEqual(['update']);
    expect(productionWrites()[0].payload).not.toHaveProperty('slug');
  });

  it('a slug taken by another production retries once with a suffix', async () => {
    state.insertErrors = [{ code: '23505', message: 'duplicate key value violates unique constraint "smart_productions_slug_key"' }, null];
    expect((await call()).status).toBe(200);
    const inserts = productionWrites().filter((c) => c.op === 'insert');
    expect(inserts.map((c) => c.payload?.slug)).toEqual(['cebo', 'cebo-creator-']);
  });

  it('a creator whose ID check passed goes to the dashboard', async () => {
    state.verificationStatus = 'verified';
    expect(await (await call()).json()).toMatchObject({ next: '/dashboard' });
  });

  it('needs a signed-in user', async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
  });
});
