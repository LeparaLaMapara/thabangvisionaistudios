import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Audit fixes (2026-10-13): service-booking disputes hold the booking, one
// live dispute per booking, client reviews reach the public ratings, and the
// /archive, Ubunye studio and community-listing reads use real columns.

// ─── In-memory Supabase fake, shared by every client ────────────────────────

type Row = Record<string, unknown>;
type Filter = { kind: 'eq' | 'is' | 'in' | 'notIn' | 'lt'; col: string; val: unknown };
interface Call { table: string; op: string; values?: Row; filters: Filter[]; select?: string; options?: Row }

const tables: Record<string, Row[]> = {};
const calls: Call[] = [];
/** Error to return for the next matching op ("table.op"), once. */
const failNext: Record<string, { message: string; code?: string }> = {};
let sessionUser: { id: string } | null = null;
let nextId = 1;
/** Makes the next disputes read see no rows (a concurrent insert). */
let blindDisputeRead = false;

const LIVE = ['open', 'investigating', 'escalated'];

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
  let values: Row = {};
  let options: Row = {};
  let selectCols = '';
  let countMode = false;
  const filters: Filter[] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) =>
    filters.every((f) => {
      const v = r[f.col] ?? null;
      if (f.kind === 'eq') return v === f.val;
      if (f.kind === 'is') return v === f.val;
      if (f.kind === 'in') return (f.val as unknown[]).includes(v);
      if (f.kind === 'notIn') return !(f.val as unknown[]).includes(v);
      if (f.kind === 'lt') return typeof v === 'number' && v < (f.val as number);
      return true;
    });
  const run = (): { data: unknown; error: unknown; count?: number } => {
    calls.push({ table, op, values, filters: [...filters], select: selectCols, options });
    const fail = failNext[`${table}.${op}`];
    if (fail) {
      delete failNext[`${table}.${op}`];
      return { data: null, error: fail };
    }
    if (op === 'insert') {
      if (table === 'disputes' && values.booking_id && rows().some((r) => r.booking_id === values.booking_id && LIVE.includes(r.status as string))) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint "disputes_one_live_per_booking"', code: '23505' } };
      }
      const row = { id: `id-${nextId++}`, ...values };
      rows().push(row);
      return { data: [row], error: null };
    }
    if (op === 'upsert') {
      const key = String(options.onConflict);
      const existing = rows().find((r) => r[key] === values[key]);
      if (existing) Object.assign(existing, values);
      else rows().push({ id: `id-${nextId++}`, ...values });
      return { data: null, error: null };
    }
    if (op === 'update') {
      const hit = rows().filter(match);
      hit.forEach((r) => Object.assign(r, values));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (op === 'delete') {
      tables[table] = rows().filter((r) => !match(r));
      return { data: null, error: null };
    }
    if (table === 'disputes' && blindDisputeRead && !countMode) {
      blindDisputeRead = false;
      return { data: [], error: null };
    }
    const hit = rows().filter(match).map((r) => ({ ...r }));
    return countMode ? { data: null, error: null, count: hit.length } : { data: hit, error: null };
  };
  const b = {
    select: (cols?: string, opts?: { count?: string }) => { selectCols = cols ?? '*'; if (opts?.count) countMode = true; return b; },
    insert: (v: Row) => { op = 'insert'; values = v; return b; },
    upsert: (v: Row, o: Row) => { op = 'upsert'; values = v; options = o; return b; },
    update: (v: Row) => { op = 'update'; values = v; return b; },
    delete: () => { op = 'delete'; return b; },
    eq: (col: string, val: unknown) => { filters.push({ kind: 'eq', col, val }); return b; },
    is: (col: string, val: unknown) => { filters.push({ kind: 'is', col, val }); return b; },
    in: (col: string, val: unknown[]) => { filters.push({ kind: 'in', col, val }); return b; },
    lt: (col: string, val: unknown) => { filters.push({ kind: 'lt', col, val }); return b; },
    not: (col: string, operator: string, val: string) => {
      if (operator === 'in') filters.push({ kind: 'notIn', col, val: val.replace(/[()]/g, '').split(',') });
      return b;
    },
    order: () => b,
    limit: () => b,
    or: () => b,
    neq: () => b,
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    single: async () => {
      const r = run();
      const d = r.data as Row[] | null;
      return d && d.length === 1 ? { data: d[0], error: r.error } : { data: null, error: r.error ?? { message: 'not one row' } };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

const client = { from: (t: string) => builder(t), auth: { getUser: async () => ({ data: { user: sessionUser } }) } };

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client, createAdminClient: () => client }));
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => (sessionUser ? { error: null, user: sessionUser } : { error: new Response(null, { status: 401 }) }),
  requireAdmin: async () => ({ error: null, user: { id: 'admin-1' } }),
  rateLimitAdmin: async () => null,
  checkNotSuspended: async () => ({ suspended: false }),
  checkRateLimit: async () => true,
}));
vi.mock('@/lib/email', () => ({ sendDisputeFiled: vi.fn(async () => undefined), sendDisputeResolved: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/profile-email', () => ({ profileWithEmail: async () => null }));
vi.mock('@/lib/rental/repos', async (orig) => ({ ...(await orig<object>()), transitionBookings: vi.fn(async () => ({ result: 'not_found' })) }));

const { POST: fileDispute } = await import('@/app/api/disputes/route');
const { PATCH: decideDispute } = await import('@/app/api/admin/disputes/[id]/route');
const { POST: reviewBooking } = await import('@/app/api/service-bookings/[id]/review/route');
const { getArchivedProductions } = await import('@/lib/supabase/queries/smartProductions');
const { getCommunityListings, isMissingTableError } = await import('@/lib/supabase/queries/smartRentals');
const { loadStudioContext } = await import('@/lib/supabase/queries/ubunyeStudio');
const { publicReviewerName } = await import('@/lib/supabase/queries/creatorReviews');

const post = (body: Row) =>
  fileDispute(new NextRequest('http://localhost/api/disputes', { method: 'POST', body: JSON.stringify(body) }));
const disputeBody = { dispute_type: 'quality_dispute', booking_id: 'b1', reason: 'The photos were never delivered.' };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(failNext)) delete failNext[k];
  calls.length = 0;
  blindDisputeRead = false;
  sessionUser = { id: 'client-1' };
  tables.bookings = [{ id: 'b1', client_id: 'client-1', creator_id: 'creator-1', status: 'delivered', client_rating: null }];
  tables.profiles = [{ id: 'client-1', display_name: 'Lerato Mokoena' }];
});

// ─── 1. A service-booking dispute holds the booking ─────────────────────────

describe('filing a dispute on a service booking', () => {
  it('moves the booking to disputed and remembers where it was', async () => {
    const res = await post(disputeBody);
    expect(res.status).toBe(201);
    expect(tables.bookings[0]).toMatchObject({ status: 'disputed', status_before_dispute: 'delivered' });
    expect(tables.bookings[0].disputed_at).toBeTruthy();
    // Never writes the gear-only columns on bookings.
    const bookingWrite = calls.find((c) => c.table === 'bookings' && c.op === 'update');
    expect(bookingWrite?.values).not.toHaveProperty('dispute_reason');
    expect(tables.disputes).toHaveLength(1);
  });

  it('a failed booking update is reported and leaves no dispute behind', async () => {
    failNext['bookings.update'] = { message: 'column "x" does not exist', code: '42703' };
    const res = await post(disputeBody);
    expect(res.status).toBe(500);
    expect(tables.disputes).toHaveLength(0);
    expect(tables.bookings[0].status).toBe('delivered');
  });

  it('a booking that is not paid or in progress keeps its status (the dispute row still holds the payout)', async () => {
    tables.bookings[0].status = 'paid_out';
    const res = await post(disputeBody);
    expect(res.status).toBe(201);
    expect(tables.bookings[0].status).toBe('paid_out');
  });
});

// ─── 2. One live dispute per booking ────────────────────────────────────────

describe('duplicate disputes', () => {
  it('an escalated dispute counts as open, even when the other party files', async () => {
    tables.disputes = [{ id: 'd0', booking_id: 'b1', filed_by: 'creator-1', status: 'escalated' }];
    const res = await post(disputeBody);
    expect(res.status).toBe(409);
    expect(tables.disputes).toHaveLength(1);
  });

  it('a resolved dispute does not block a new one', async () => {
    tables.disputes = [{ id: 'd0', booking_id: 'b1', filed_by: 'client-1', status: 'resolved' }];
    expect((await post(disputeBody)).status).toBe(201);
  });

  it('a failed duplicate read refuses (500) instead of filing blind', async () => {
    failNext['disputes.select'] = { message: 'transient' };
    expect((await post(disputeBody)).status).toBe(500);
    expect(tables.disputes ?? []).toHaveLength(0);
  });

  it('two filings at once: the unique index answers 409, not 500', async () => {
    tables.disputes = [{ id: 'race', booking_id: 'b1', filed_by: 'creator-1', status: 'open' }];
    blindDisputeRead = true; // the other filing lands between the read and the insert
    const res = await post(disputeBody);
    expect(res.status).toBe(409);
    expect(tables.disputes).toHaveLength(1);
    expect(tables.bookings[0].status).toBe('delivered');
  });

  it('closing the dispute puts the booking back where it was', async () => {
    await post(disputeBody);
    const disputeId = tables.disputes[0].id as string;
    tables.disputes[0].dispute_type = 'quality_dispute';
    const res = await decideDispute(
      new NextRequest(`http://localhost/api/admin/disputes/${disputeId}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }),
      { params: Promise.resolve({ id: disputeId }) },
    );
    expect(res.status).toBe(200);
    expect(tables.bookings[0]).toMatchObject({ status: 'delivered', status_before_dispute: null });
  });
});

// ─── 3. Client reviews reach the public ratings ─────────────────────────────

const review = (body: Row) =>
  reviewBooking(new NextRequest('http://localhost/api/service-bookings/b1/review', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'b1' }),
  });

describe('service booking reviews', () => {
  beforeEach(() => {
    tables.bookings[0].status = 'completed';
  });

  it('writes one published crew review of the creator, with the first name only', async () => {
    const res = await review({ rating: 5, review: '  Great shoot  ' });
    expect(res.status).toBe(200);
    expect(tables.reviews).toEqual([
      expect.objectContaining({
        review_type: 'crew',
        booking_id: 'b1',
        reviewer_id: 'client-1',
        reviewer_name: 'Lerato',
        reviewee_id: 'creator-1',
        rating: 5,
        comment: 'Great shoot',
        is_published: true,
      }),
    ]);
    expect(tables.bookings[0]).toMatchObject({ client_rating: 5, client_review: 'Great shoot' });
    expect((await review({ rating: 1 })).status).toBe(409);
    expect(tables.reviews).toHaveLength(1);
  });

  it('a retry after a failed booking write updates the same review, never a second one', async () => {
    failNext['bookings.update'] = { message: 'boom' };
    expect((await review({ rating: 4 })).status).toBe(500);
    expect((await review({ rating: 4 })).status).toBe(200);
    expect(tables.reviews).toHaveLength(1);
  });

  it('a failed review write saves nothing on the booking', async () => {
    failNext['reviews.upsert'] = { message: 'boom' };
    expect((await review({ rating: 4 })).status).toBe(500);
    expect(tables.bookings[0].client_rating).toBeNull();
  });

  it('refuses a rating that is not a whole number from 1 to 5', async () => {
    expect((await review({ rating: 4.5 })).status).toBe(400);
    expect((await review({ rating: 0 })).status).toBe(400);
  });

  it('publicReviewerName keeps the first name only', () => {
    expect(publicReviewerName('  Thabo  Nkosi ')).toBe('Thabo');
    expect(publicReviewerName('')).toBeNull();
    expect(publicReviewerName(null)).toBeNull();
  });
});

// ─── 4-6. Reads that used columns which do not exist ────────────────────────

describe('reads use real columns', () => {
  it('/archive productions are published, not deleted and from an earlier year', async () => {
    tables.smart_productions = [
      { id: 'p1', is_published: true, deleted_at: null, year: 2025 },
      { id: 'p2', is_published: true, deleted_at: null, year: 2026 },
      { id: 'p3', is_published: true, deleted_at: '2026-01-01', year: 2024 },
    ];
    const rows = await getArchivedProductions(new Date('2026-10-13T10:00:00Z'));
    expect(rows.map((r) => r.id)).toEqual(['p1']);
    const read = calls.find((c) => c.table === 'smart_productions');
    expect(read?.filters.map((f) => f.col)).not.toContain('is_archived');
  });

  it('the Ubunye studio reads published rows, not a status column', async () => {
    tables.smart_rentals = [
      { id: 'r1', is_published: true, is_archived: false, deleted_at: null, is_available: true },
      { id: 'r2', is_published: false, is_archived: false, deleted_at: null, is_available: true },
    ];
    tables.smart_productions = [{ id: 'p1', is_published: true, deleted_at: null }];
    const ctx = await loadStudioContext(client as never);
    expect(ctx.featuredGear.map((g) => g.id)).toEqual(['r1']);
    expect(ctx.featuredProductions.map((p) => p.id)).toEqual(['p1']);
    expect(calls.flatMap((c) => c.filters.map((f) => f.col))).not.toContain('status');
  });

  it('community listings select only real columns and log a column error', async () => {
    tables.listings = [{ id: 'l1', slug: 's', title: 'Tripod', category: 'x', price: 150, is_published: true, deleted_at: null }];
    const rows = await getCommunityListings();
    expect(rows[0].price_per_day).toBe(150);
    expect(calls.find((c) => c.table === 'listings')?.select).not.toContain('price_per_day');

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failNext['listings.select'] = { message: 'column listings.price_per_day does not exist', code: '42703' };
    expect(await getCommunityListings()).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockClear();
    failNext['listings.select'] = { message: 'relation "public.listings" does not exist', code: '42P01' };
    expect(await getCommunityListings()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('isMissingTableError tells a missing table from a missing column', () => {
    expect(isMissingTableError({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true);
    expect(isMissingTableError({ code: '42703', message: 'column x does not exist' })).toBe(false);
  });
});
