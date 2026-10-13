import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// Admin refunds on service bookings (admin cancel, dispute resolution) are
// CLAIMED before the provider is called. Paystack takes no idempotency key on
// a refund, so before this two callers that both read "no refund yet" both
// refunded, and the loser's refusal ("fully reversed") was written as 'failed'
// over the winner's 'refunded' and staff were told to refund by hand.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

// Reads of a booking with .single() can be held at a gate, so two requests
// can be made to read the same state before either writes (a double click).
const gates: Promise<void>[] = [];

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let values: Row = {};
  const filters: [string, unknown, 'eq' | 'is'][] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) => filters.every(([k, v, kind]) => (kind === 'is' ? (r[k] ?? null) === v : r[k] === v));
  const run = () => {
    if (op === 'insert') {
      rows().push({ ...values });
      return { data: [values], error: null };
    }
    const hit = rows().filter(match);
    if (op === 'update') hit.forEach((r) => Object.assign(r, values));
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    update: (v: Row) => { op = 'update'; values = v; return b; },
    insert: (v: Row) => { op = 'insert'; values = v; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v, 'eq']); return b; },
    is: (k: string, v: unknown) => { filters.push([k, v, 'is']); return b; },
    in: () => b,
    maybeSingle: async () => ({ data: (run().data as Row[])[0] ?? null, error: null }),
    single: async () => {
      // Snapshot first, then wait: the request acts on what it read.
      const d = run().data as Row[];
      if (table === 'bookings' && gates.length) await gates.shift();
      return d.length === 1 ? { data: d[0], error: null } : { data: null, error: { message: 'not one row' } };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

let sessionUser: { id: string } | null = null;
const client = {
  from: (t: string) => builder(t),
  auth: {
    getUser: async () => ({ data: { user: sessionUser } }),
    admin: { getUserById: async () => ({ data: { user: { email: 'creator@example.invalid' } } }) },
  },
};

type RefundAttempt = import('@/lib/payments/routing').RefundAttempt;
const refundWithOutcome = vi.fn<(p: { reference: string; amountRands: number; idempotencyKey: string }) => Promise<RefundAttempt>>();
const sendEmail = vi.fn<(m: { to: string; subject: string; text: string }) => Promise<void>>(async () => undefined);

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => client, createClient: async () => client }));
vi.mock('@/lib/auth', () => ({
  requireAdmin: async () => ({ error: null, user: { id: 'admin-1' } }),
  rateLimitAdmin: async () => null,
  checkRateLimit: async () => true,
}));
vi.mock('@/lib/payments/routing', () => ({ refundWithOutcome, refundPayment: vi.fn(), isManualReference: () => false }));
vi.mock('@/lib/email', () => ({ email: { sendEmail }, sendDisputeResolved: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/profile-email', () => ({ profileWithEmail: async () => null }));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));
vi.mock('@/lib/bookings/notify-client', () => ({ notifyClient: vi.fn(async () => undefined) }));

const { PATCH: ADMIN_PATCH } = await import('@/app/api/admin/service-bookings/[id]/route');
const { PATCH: DISPUTE_PATCH } = await import('@/app/api/admin/disputes/[id]/route');
const { PATCH: STATUS_PATCH } = await import('@/app/api/service-bookings/[id]/status/route');
const { claimServiceRefund, recordServiceRefundOutcome } = await import('@/lib/payments/service-refunds');

const ID = 'b-1';

function seed(over: Row = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  gates.length = 0;
  tables.bookings = [{
    id: ID, reference: 'BK-test', client_id: 'client-1', client_email: 'client@example.invalid', creator_id: 'creator-1',
    project_category: 'Portrait Photography', status: 'accepted', total: 1000, creator_amount: 850,
    payment_status: 'paid', payout_status: 'pending', shoot_date: '2099-01-01', paystack_reference: 'PAY-1',
    created_at: '2026-09-01T00:00:00.000Z', delivered_at: null, delivery_url: null, revisions_included: 1, revisions_used: 0,
    cancellation_refund_status: null,
    ...over,
  }];
  tables.disputes = [{ id: 'd1', booking_id: ID, equipment_booking_id: null, filed_by: 'client-1', status: 'open' }];
}

const adminCancel = async () => {
  const res = await ADMIN_PATCH(
    new NextRequest('http://localhost/api/admin/service-bookings/b-1', { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', cancellation_reason: 'ops' }) }),
    { params: Promise.resolve({ id: ID }) },
  );
  return { status: res.status, json: (await res.json()) as Row };
};

const resolveDispute = async (body: Row) => {
  const res = await DISPUTE_PATCH(
    new NextRequest('http://localhost/api/admin/disputes/d1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'd1' }) },
  );
  return { status: res.status, json: (await res.json()) as Row };
};

const clientCancel = async () => {
  sessionUser = { id: 'client-1' };
  const res = await STATUS_PATCH(
    new NextRequest('http://localhost/api/service-bookings/b-1/status', { method: 'PATCH', body: JSON.stringify({ action: 'cancel' }) }),
    { params: Promise.resolve({ id: ID }) },
  );
  return { status: res.status, json: (await res.json()) as Row };
};

/** A gate the test opens by hand. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => { open = r; });
  return { wait, open };
}

/** Lets pending promise callbacks run (the gated request reaches its gate). */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Paystack's real behaviour on a second full refund of the same payment: it
 * refuses ("fully reversed"). Before the claim, that refusal was recorded as
 * 'failed' over the first refund's 'refunded'.
 */
function providerThatRefusesASecondRefund() {
  let refunded = 0;
  refundWithOutcome.mockImplementation(async (p) => {
    if (refunded + p.amountRands > 1000) return { outcome: 'rejected', message: 'Transaction has been fully reversed' };
    refunded += p.amountRands;
    return { outcome: 'refunded', providerRefundId: `rf_${refunded}` };
  });
}

beforeEach(() => {
  refundWithOutcome.mockReset();
  sendEmail.mockClear();
});

describe('admin cancel: claimed before the provider is called', () => {
  it('a double click (both requests read "no refund yet"): one refund, the second gets 409 and changes nothing', async () => {
    seed();
    providerThatRefusesASecondRefund();
    const g = gate();
    gates.push(g.wait); // the first request reads, then waits
    const first = adminCancel();
    await tick();
    const second = await adminCancel(); // reads the same state, claims, refunds, records
    g.open();
    const a = await first;

    const results = [a.status, second.status].sort();
    expect(results).toEqual([200, 409]);
    expect(refundWithOutcome).toHaveBeenCalledTimes(1);
    expect(tables.bookings[0]).toMatchObject({ status: 'cancelled', cancellation_refund_status: 'refunded', payment_status: 'refunded', cancellation_refund_amount: 1000 });
    // Nobody was told to refund by hand.
    expect(sendEmail).not.toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/Action Required/) }));
    expect(a.json.code).toBe('BOOKING_CHANGED');
  });

  it('a second cancel after the first finished sends nothing and never overwrites "refunded"', async () => {
    seed();
    providerThatRefusesASecondRefund();
    expect((await adminCancel()).json.refund_status).toBe('refunded');
    const again = await adminCancel();
    expect(again.status).toBe(200);
    // The payment is marked refunded, so nothing more is due.
    expect(again.json.refund_status).toBeUndefined();
    expect(refundWithOutcome).toHaveBeenCalledTimes(1);
    expect(tables.bookings[0].cancellation_refund_status).toBe('refunded');
  });

  it('racing a client cancellation: whichever writes second gets 409 and sends nothing', async () => {
    seed();
    providerThatRefusesASecondRefund();
    const g = gate();
    gates.push(g.wait); // the admin reads 'accepted', no refund
    const admin = adminCancel();
    await tick();
    const client = await clientCancel(); // cancels, refunds by the tiers, records
    expect(client.status).toBe(200);
    g.open();
    const a = await admin;
    expect(a.status).toBe(409);
    expect(refundWithOutcome).toHaveBeenCalledTimes(1);
    expect(tables.bookings[0]).toMatchObject({ status: 'cancelled', cancellation_refund_status: 'refunded' });
  });

  it('and the other way round: the client cannot cancel (and refund) over an admin cancel in progress', async () => {
    seed();
    const pending = gate();
    // The admin's refund call hangs: the claim is written, the outcome is not.
    refundWithOutcome.mockImplementationOnce(async () => { await pending.wait; return { outcome: 'refunded', providerRefundId: 'rf_1' }; });
    const admin = adminCancel();
    await tick();
    expect(tables.bookings[0]).toMatchObject({ status: 'cancelled', cancellation_refund_status: 'pending', cancellation_refund_amount: 1000 });
    const client = await clientCancel();
    expect(client.status).toBe(400); // already cancelled: not allowed from 'cancelled'
    pending.open();
    expect((await admin).status).toBe(200);
    expect(refundWithOutcome).toHaveBeenCalledTimes(1);
    expect(tables.bookings[0].cancellation_refund_status).toBe('refunded');
  });

  it('a booking left "pending" (the process died after the claim) is never refunded automatically again', async () => {
    seed({ status: 'cancelled', cancellation_refund_status: 'pending', cancellation_refund_amount: 1000 });
    const r = await adminCancel();
    expect(r.json.refund_status).toBe('already_started');
    expect(refundWithOutcome).not.toHaveBeenCalled();
    // A person is told, so the stuck claim is not forgotten.
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/Refund already on record/), text: expect.stringMatching(/\(pending\)[\s\S]*CHECK the payment provider/) }));
  });

  it('manual_review is a person\'s job: no automatic refund, staff told, the client is not promised an amount', async () => {
    seed({ cancellation_refund_status: 'manual_review' });
    const r = await adminCancel();
    expect(r.status).toBe(200);
    expect(r.json.refund_status).toBe('not_claimed');
    expect(refundWithOutcome).not.toHaveBeenCalled();
    expect(tables.bookings[0]).toMatchObject({ status: 'cancelled', cancellation_refund_status: 'manual_review' });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/without an automatic refund/) }));
  });
});

describe('dispute refunds: claimed, never twice', () => {
  it('two concurrent partial refunds of R500 on R1000: one is sent, the other gets 409', async () => {
    seed({ status: 'disputed' });
    providerThatRefusesASecondRefund(); // would accept both: R500 + R500 = R1000
    const g = gate();
    gates.push(g.wait);
    const first = resolveDispute({ status: 'resolved', resolution: 'partial_refund', resolution_amount: 500 });
    await tick();
    const second = await resolveDispute({ status: 'resolved', resolution: 'partial_refund', resolution_amount: 500 });
    g.open();
    const a = await first;
    expect([a.status, second.status].sort()).toEqual([200, 409]);
    expect(refundWithOutcome).toHaveBeenCalledTimes(1);
    expect(tables.bookings[0]).toMatchObject({ cancellation_refund_status: 'refunded', cancellation_refund_amount: 500, payment_status: 'paid' });
  });

  it('refuses a manual_review refund (a person is handling it)', async () => {
    seed({ status: 'disputed', cancellation_refund_status: 'manual_review' });
    const r = await resolveDispute({ status: 'resolved', resolution: 'full_refund' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('REFUND_NEEDS_A_PERSON');
    expect(refundWithOutcome).not.toHaveBeenCalled();
  });
});

describe('never refund the client after the creator was paid', () => {
  const sent: Row[] = [
    { status: 'completed', payout_status: 'processing' },
    { status: 'paid_out', payout_status: 'paid' },
    { status: 'completed', payout_status: 'paid' },
    { status: 'disputed', payout_status: 'processing' },
  ];

  it.each(sent)('admin cancel is refused with PAYOUT_ALREADY_SENT (%o) and nothing is written', async (over) => {
    seed(over);
    const before = { ...tables.bookings[0] };
    const r = await adminCancel();
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('PAYOUT_ALREADY_SENT');
    expect(refundWithOutcome).not.toHaveBeenCalled();
    expect(tables.bookings[0]).toEqual(before);
  });

  it.each(sent)('a dispute refund is refused with PAYOUT_ALREADY_SENT (%o)', async (over) => {
    seed(over);
    const r = await resolveDispute({ status: 'resolved', resolution: 'full_refund' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('PAYOUT_ALREADY_SENT');
    expect(refundWithOutcome).not.toHaveBeenCalled();
    expect(tables.bookings[0].cancellation_refund_status).toBeNull();
  });

  it('a payout claimed between the admin\'s read and write wins: the cancel gets 409', async () => {
    seed({ status: 'completed' });
    const g = gate();
    gates.push(g.wait);
    const admin = adminCancel();
    await tick();
    tables.bookings[0].payout_status = 'processing'; // the payout run claimed it
    g.open();
    const r = await admin;
    expect(r.status).toBe(409);
    expect(refundWithOutcome).not.toHaveBeenCalled();
    expect(tables.bookings[0]).toMatchObject({ status: 'completed', cancellation_refund_status: null });
  });
});

describe('what the client is told on an admin cancel', () => {
  const clientEmail = () => sendEmail.mock.calls.map((c) => c[0]).find((m) => m.to === 'client@example.invalid');

  it('promises the amount only when the provider accepted the refund', async () => {
    seed();
    refundWithOutcome.mockResolvedValue({ outcome: 'refunded', providerRefundId: 'rf_1' });
    await adminCancel();
    expect(clientEmail()?.text).toMatch(/A refund of R1000 is being processed/);
  });

  it.each([
    [{ outcome: 'rejected', message: 'declined' }],
    [{ outcome: 'unknown', message: 'timeout' }],
    [{ outcome: 'manual', message: 'EFT' }],
  ] as [RefundAttempt][])('otherwise "our team will be in touch", with no amount (%o)', async (attempt) => {
    seed();
    refundWithOutcome.mockResolvedValue(attempt);
    await adminCancel();
    const text = clientEmail()?.text ?? '';
    expect(text).toMatch(/Our team will be in touch with you about your refund/);
    expect(text).not.toMatch(/R1000/);
    expect(text).not.toMatch(/being processed/);
  });

  it('and when a refund was already handled elsewhere', async () => {
    seed({ status: 'cancelled', cancellation_refund_status: 'unknown' });
    await adminCancel();
    const text = clientEmail()?.text ?? '';
    expect(text).toMatch(/Our team will be in touch/);
    expect(text).not.toMatch(/R1000/);
  });
});

describe('the claim and the record (lib/payments/service-refunds.ts)', () => {
  const db = client as unknown as SupabaseClient;
  const NOW = new Date('2026-10-09T10:00:00.000Z');

  it('claims only from what was read; a second claim on the same read loses', async () => {
    seed();
    const target = { id: ID, status: 'accepted', payoutStatus: 'pending', refundStatus: null };
    expect(await claimServiceRefund(db, target, { amountRands: 1000, now: NOW })).toEqual({ claimed: true });
    expect(tables.bookings[0]).toMatchObject({ cancellation_refund_status: 'pending', cancellation_refund_amount: 1000 });
    expect(await claimServiceRefund(db, target, { amountRands: 1000, now: NOW })).toEqual({ claimed: false, error: null });
  });

  it('a refused attempt (failed) can be claimed again; manual_review, not_required and anything started cannot', async () => {
    for (const s of ['failed']) {
      seed({ cancellation_refund_status: s });
      expect((await claimServiceRefund(db, { id: ID, status: 'accepted', payoutStatus: 'pending', refundStatus: s }, { amountRands: 1000, now: NOW })).claimed).toBe(true);
    }
    for (const s of ['manual_review', 'not_required', 'pending', 'refunded', 'unknown']) {
      seed({ cancellation_refund_status: s });
      expect((await claimServiceRefund(db, { id: ID, status: 'accepted', payoutStatus: 'pending', refundStatus: s }, { amountRands: 1000, now: NOW })).claimed).toBe(false);
      expect(tables.bookings[0].cancellation_refund_status).toBe(s);
    }
  });

  it('a late "failed" never overwrites "refunded" (or anything but its own pending claim)', async () => {
    seed({ cancellation_refund_status: 'pending' });
    const ok = await recordServiceRefundOutcome(db, { bookingId: ID, attempt: { outcome: 'refunded', providerRefundId: 'rf_1' }, amountRands: 1000, total: 1000 });
    expect(ok).toMatchObject({ outcome: 'refunded', recorded: true });
    const late = await recordServiceRefundOutcome(db, { bookingId: ID, attempt: { outcome: 'rejected', message: 'Transaction has been fully reversed' }, amountRands: 1000, total: 1000 });
    expect(late).toMatchObject({ outcome: 'failed', recorded: false });
    expect(tables.bookings[0]).toMatchObject({ cancellation_refund_status: 'refunded', payment_status: 'refunded', cancellation_refund_error: null });

    for (const s of ['unknown', 'manual_review']) {
      seed({ cancellation_refund_status: s });
      const r = await recordServiceRefundOutcome(db, { bookingId: ID, attempt: { outcome: 'rejected', message: 'x' }, amountRands: 1000, total: 1000 });
      expect(r.recorded).toBe(false);
      expect(tables.bookings[0].cancellation_refund_status).toBe(s);
    }
  });
});
