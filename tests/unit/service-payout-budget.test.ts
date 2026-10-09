import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PayoutPort, ProviderCallResult, ProviderTransfer } from '@/lib/core/ports';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));
vi.mock('@/lib/email', () => ({ email: { sendEmail: vi.fn(async () => undefined) } }));

const { triggerCreatorPayout, runServicePayouts, PAYOUT_RUN_TIME_BUDGET_MS } = await import('@/lib/payments/payout');
const { checkServicePayoutEligibility, payoutAlreadySent, checkServiceRefund, refundClaimable } = await import('@/lib/core/services/fulfilment');

// Creator payouts and client refunds on the same service booking: a refund
// recorded or started holds the payout; and the daily payout run stops
// starting new payouts before the cron's 60 s limit, reaching fresh payouts
// before ones already known to be held.

type Row = Record<string, unknown>;
interface Write { table: string; op: 'update' | 'insert'; values: Row; filters: [string, string, unknown][] }

function fakeDb(tables: Record<string, Row[]>, hooks: { onBookingRead?: (id: unknown) => void } = {}) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Row = {};
    let head = false;
    let window: [number, number] | null = null;
    const filters: [string, string, unknown][] = [];
    const rows = (): Row[] => (tables[table] ??= []);
    const match = (r: Row): boolean => filters.every(([kind, k, v]) => {
      if (kind === 'eq') return r[k] === v;
      if (kind === 'neq') return r[k] !== v;
      if (kind === 'is') return (r[k] ?? null) === v;
      if (kind === 'in') return (v as unknown[]).includes(r[k]);
      return true;
    });
    const run = () => {
      if (op === 'insert') {
        writes.push({ table, op, values, filters: [...filters] });
        rows().push({ ...values });
        return { data: [values], error: null, count: null };
      }
      const hit = rows().filter(match);
      if (op === 'update') {
        writes.push({ table, op, values, filters: [...filters] });
        hit.forEach((r) => Object.assign(r, values));
      }
      const page = window ? hit.slice(window[0], window[1] + 1) : hit;
      return { data: head ? null : page.map((r) => ({ ...r })), error: null, count: hit.length };
    };
    const b = {
      select: (_c?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return b; },
      update: (v: Row) => { op = 'update'; values = v; return b; },
      insert: (v: Row) => { op = 'insert'; values = v; return b; },
      eq: (k: string, v: unknown) => { filters.push(['eq', k, v]); return b; },
      neq: (k: string, v: unknown) => { filters.push(['neq', k, v]); return b; },
      is: (k: string, v: unknown) => { filters.push(['is', k, v]); return b; },
      in: (k: string, v: unknown[]) => { filters.push(['in', k, v]); return b; },
      not: () => b,
      or: () => b,
      order: () => b,
      limit: (n: number) => { window = [0, n - 1]; return b; },
      range: (a: number, z: number) => { window = [a, z]; return b; },
      maybeSingle: async () => {
        if (table === 'bookings' && op === 'select') hooks.onBookingRead?.(filters.find(([, k]) => k === 'id')?.[2]);
        const r = run();
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
      },
      single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  const db = { from, auth: { admin: { getUserById: async () => ({ data: { user: { email: 'creator@example.invalid' } } }) } } };
  return { db: db as unknown as SupabaseClient, writes, tables };
}

const NOW = new Date('2026-10-09T10:00:00.000Z');
const H = 3_600_000;
const idN = (n: number) => `9b2f1c3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ago = (hours: number) => new Date(NOW.getTime() - hours * H).toISOString();

function booking(over: Row = {}): Row {
  return {
    id: idN(1), reference: 'BK-test', paystack_reference: 'BK-test', status: 'completed', payment_status: 'paid',
    payout_status: 'pending', payout_reference: null, payout_retry_count: 0, creator_id: 'creator-1', creator_amount: 2550,
    total: 3000, project_category: 'Portrait Photography', completed_at: ago(73), updated_at: '2026-10-06T09:00:00.000Z',
    payout_due_at: ago(1), payout_claimed_at: null, payout_last_error: null, cancellation_refund_status: null,
    ...over,
  };
}

function world(bookings: Row[], hooks: { onBookingRead?: (id: unknown) => void } = {}) {
  return fakeDb({
    bookings,
    profiles: [{ id: 'creator-1', verification_status: 'verified' }, { id: 'creator-unverified', verification_status: 'pending' }],
    banking_details: [
      { user_id: 'creator-1', is_verified: true, paystack_recipient_code: 'RCP_1', account_holder: 'T Creator' },
      { user_id: 'creator-unverified', is_verified: true, paystack_recipient_code: 'RCP_2' },
    ],
    disputes: [],
    notifications: [],
    service_booking_events: [],
  }, hooks);
}

function port(lookup: ProviderCallResult<ProviderTransfer | null> = { ok: true, value: null }) {
  const transfer = vi.fn(async () => ({ ok: true as const, value: { transferCode: 'TRF_1', status: 'pending', amountCents: 255_000 } }));
  const verifyTransfer = vi.fn(async () => lookup);
  const p: PayoutPort = {
    provider: 'fake',
    capabilities: { bankTransfers: true, instantTransfers: false, transferVerification: true, currencies: ['ZAR'], countries: ['ZA'] },
    transfer,
    verifyTransfer,
  };
  return { p, transfer, verifyTransfer };
}

const confirmed = vi.fn(async () => ({ success: true, amount: 3000 }));
beforeEach(() => confirmed.mockClear());

describe('a refund recorded or started holds the creator payout', () => {
  const ok = {
    status: 'completed', paymentStatus: 'paid', payoutStatus: 'pending', creatorId: 'c', creatorVerified: true,
    payoutAccountValidated: true, creatorAmount: 850, total: 1000, providerConfirmation: { success: true, amount: 1000 },
    openDisputes: 0, completedAt: ago(73), payoutDueAt: ago(1),
  };

  it.each(['refunded', 'pending', 'unknown', 'failed', 'manual_review'])('eligibility refuses with refund_recorded (%s)', (s) => {
    expect(checkServicePayoutEligibility({ ...ok, refundStatus: s }, NOW)).toMatchObject({ eligible: false, reasons: ['refund_recorded'] });
  });

  it.each([null, 'not_required', undefined])('no refund on record does not hold it (%s)', (s) => {
    expect(checkServicePayoutEligibility({ ...ok, refundStatus: s }, NOW).eligible).toBe(true);
  });

  it('a completed booking refunded through a dispute is not paid out', async () => {
    const w = world([booking({ cancellation_refund_status: 'refunded' })]);
    const t = port();
    const r = await triggerCreatorPayout({ bookingId: idN(1) }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r).toMatchObject({ outcome: 'blocked', reasons: ['refund_recorded'] });
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('a refund claimed between the payout\'s read and its claim wins: nothing is sent', async () => {
    const w = world([booking()]);
    const t = port();
    // The admin claims the refund while the payout is checking the payment.
    const verifyCharge = vi.fn(async () => {
      Object.assign(w.tables.bookings[0], { cancellation_refund_status: 'pending', updated_at: '2026-10-09T09:59:59.000Z' });
      return { success: true, amount: 3000 };
    });
    const r = await triggerCreatorPayout({ bookingId: idN(1) }, { db: w.db, transfers: t.p, verifyCharge, now: NOW });
    expect(r.success).toBe(false);
    expect(t.transfer).not.toHaveBeenCalled();
    expect(w.tables.bookings[0].payout_status).toBe('pending');
  });

  it('the payout claim compares the refund status it read', async () => {
    const w = world([booking()]);
    const t = port();
    await triggerCreatorPayout({ bookingId: idN(1) }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    const claim = w.writes.find((x) => x.table === 'bookings' && x.values.payout_status === 'processing');
    expect(claim?.filters).toEqual(expect.arrayContaining([['is', 'cancellation_refund_status', null]]));
  });

  it('refund rules: payout sent, refund started, claimable', () => {
    expect(payoutAlreadySent({ status: 'completed', payoutStatus: 'processing' })).toBe(true);
    expect(payoutAlreadySent({ status: 'completed', payoutStatus: 'paid' })).toBe(true);
    expect(payoutAlreadySent({ status: 'paid_out', payoutStatus: 'pending' })).toBe(true);
    expect(payoutAlreadySent({ status: 'completed', payoutStatus: 'failed' })).toBe(false);
    expect(checkServiceRefund({ status: 'completed', payoutStatus: 'paid', refundStatus: null })).toMatchObject({ ok: false, code: 'PAYOUT_ALREADY_SENT' });
    expect(checkServiceRefund({ status: 'accepted', payoutStatus: 'pending', refundStatus: 'pending' })).toMatchObject({ ok: false, code: 'REFUND_ALREADY_STARTED' });
    expect(checkServiceRefund({ status: 'accepted', payoutStatus: 'pending', refundStatus: 'manual_review' })).toMatchObject({ ok: false, code: 'REFUND_NEEDS_A_PERSON' });
    expect(refundClaimable(null)).toBe(true);
    expect(refundClaimable('failed')).toBe(true);
    expect(refundClaimable('not_required')).toBe(false);
  });
});

describe('a held payout is remembered, so the next run reaches fresh ones first', () => {
  it('writes why it is held once, and not again while nothing changed', async () => {
    const w = world([booking({ creator_id: 'creator-unverified' })]);
    const t = port();
    await triggerCreatorPayout({ bookingId: idN(1) }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(String(w.tables.bookings[0].payout_last_error)).toMatch(/^held: .*ID check/);
    const writes = w.writes.length;
    await triggerCreatorPayout({ bookingId: idN(1) }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(w.writes.length).toBe(writes);
  });

  it('"not due yet" alone is not a problem and is not written', async () => {
    const w = world([booking({ payout_due_at: new Date(NOW.getTime() + H).toISOString() })]);
    await triggerCreatorPayout({ bookingId: idN(1) }, { db: w.db, transfers: port().p, verifyCharge: confirmed, now: NOW });
    expect(w.tables.bookings[0].payout_last_error).toBeNull();
  });
});

describe('the daily run keeps to its time budget', () => {
  /** Each payout the run works on costs 10 s of the fake clock (one booking read each). */
  function timed(rows: Row[]) {
    let t = 0;
    const order: unknown[] = [];
    const w = world(rows, { onBookingRead: (id) => { order.push(id); t += 10_000; } });
    return { w, order, clock: () => t };
  }

  it('stops starting new payouts once the budget is used, and reports what it did not reach', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => booking({ id: idN(10 + i), reference: `BK-${i}`, completed_at: ago(90 - i), payout_due_at: ago(10 - i) }));
    const { w, clock } = timed(rows);
    const t = port();
    const s = await runServicePayouts({ db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW }, 50, 1000, { timeBudgetMs: 35_000, clock });
    // Started at 0, 10, 20 and 30 s; at 40 s no new payout starts.
    expect(t.transfer).toHaveBeenCalledTimes(4);
    expect(s).toMatchObject({ considered: 4, notProcessed: 2, outcomes: { sent: 4 } });
    expect(s.attention).toContainEqual({ reference: 'payout run', why: expect.stringMatching(/^2 due payouts not processed this run \(time budget of 35s reached\)/) });
  });

  it('a run inside its budget reports nothing extra', async () => {
    const { w, clock } = timed([booking()]);
    const s = await runServicePayouts({ db: w.db, transfers: port().p, verifyCharge: confirmed, now: NOW }, 50, 1000, { timeBudgetMs: 35_000, clock });
    expect(s.notProcessed).toBe(0);
    expect(s.attention).toEqual([]);
  });

  it('the budget counts from the start the cron passes (time already spent on earlier steps)', async () => {
    const { w, clock } = timed([booking()]);
    const t = port();
    const s = await runServicePayouts({ db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW }, 50, 1000, { clock, startedAt: -PAYOUT_RUN_TIME_BUDGET_MS });
    expect(s).toMatchObject({ considered: 0, notProcessed: 1 });
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('works in flight first, then fresh due payouts, then ones already known to be held or failed', async () => {
    const rows = [
      // Oldest first in the queue: held, then a refused transfer...
      booking({ id: idN(1), reference: 'BK-held', creator_id: 'creator-unverified', completed_at: ago(500), payout_due_at: ago(400), payout_last_error: 'held: the creator has not passed the ID check' }),
      booking({ id: idN(2), reference: 'BK-failed', payout_status: 'failed', payout_reference: 'tvsp_9b2f1c3e000040008000000000000002', payout_retry_count: 1, completed_at: ago(300), payout_due_at: ago(200) }),
      // ...then a fresh due one, then one in flight with the provider.
      booking({ id: idN(3), reference: 'BK-fresh', completed_at: ago(80), payout_due_at: ago(8) }),
      booking({ id: idN(4), reference: 'BK-flight', payout_status: 'processing', payout_reference: 'tvsp_9b2f1c3e000040008000000000000004', payout_claimed_at: new Date(NOW.getTime() - 60_000).toISOString(), completed_at: ago(75), payout_due_at: ago(3) }),
    ];
    const { w, order, clock } = timed(rows);
    const t = port();
    const s = await runServicePayouts({ db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW }, 50, 1000, { timeBudgetMs: 15_000, clock });
    expect(order).toEqual([idN(4), idN(3)]);
    expect(t.transfer).toHaveBeenCalledTimes(1);
    expect(t.transfer).toHaveBeenCalledWith(expect.objectContaining({ reference: 'tvsp_9b2f1c3e000040008000000000000003' }));
    expect(s.notProcessed).toBe(2);
  });
});
