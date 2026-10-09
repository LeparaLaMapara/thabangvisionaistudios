import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { WebhookResult } from '@/lib/payments/types';

// ─── Recording Supabase fake shared by the session and service-role clients ──

type Row = Record<string, unknown>;
interface Write { table: string; op: 'update' | 'insert'; values: Row; filters: [string, unknown][] }

const tables: Record<string, Row[]> = {};
const writes: Write[] = [];
let failNextBookingUpdateWith: { message: string; code?: string } | null = null;
let sessionUser: { id: string; email: string } | null = null;

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let values: Row = {};
  const filters: [string, unknown][] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const run = () => {
    if (op === 'insert') {
      writes.push({ table, op, values, filters: [] });
      rows().push({ ...values });
      return { data: [values], error: null };
    }
    if (op === 'update') {
      if (table === 'bookings' && failNextBookingUpdateWith) {
        const error = failNextBookingUpdateWith;
        failNextBookingUpdateWith = null;
        return { data: null, error };
      }
      writes.push({ table, op, values, filters: [...filters] });
      const hit = rows().filter(match);
      hit.forEach((r) => Object.assign(r, values));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    return { data: rows().filter(match).map((r) => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    update: (v: Row) => { op = 'update'; values = v; return b; },
    insert: (v: Row) => { op = 'insert'; values = v; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); const d = r.data as Row[] | null; return d && d.length === 1 ? { data: d[0], error: null } : { data: null, error: { message: 'not one row' } }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

const client = {
  from: (t: string) => builder(t),
  auth: {
    getUser: async () => ({ data: { user: sessionUser } }),
    admin: { getUserById: async () => ({ data: { user: { email: 'creator@example.invalid' } } }) },
  },
};

const refundPayment = vi.fn<(ref: string, amount?: number) => Promise<{ success: boolean; error?: string }>>(async () => ({ success: true }));
const sendEmail = vi.fn(async () => undefined);
const notifyClient = vi.fn(async () => undefined);
const triggerCreatorPayout = vi.fn(async () => ({ success: true, outcome: 'sent' }));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client, createAdminClient: () => client }));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/email', () => ({ email: { sendEmail } }));
vi.mock('@/lib/payments/routing', () => ({ refundPayment }));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));
vi.mock('@/lib/bookings/notify-client', () => ({ notifyClient }));
// Approving work must never pay on the spot: fail loudly if anything tries.
vi.mock('@/lib/payments/payout', () => ({ triggerCreatorPayout }));

const { PATCH } = await import('@/app/api/service-bookings/[id]/status/route');

const CLIENT = { id: 'client-1', email: 'client@example.invalid' };
const CREATOR = { id: 'creator-1', email: 'creator@example.invalid' };
const ID = 'b-1';

function seed(over: Row = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  writes.length = 0;
  tables.bookings = [{
    id: ID, reference: 'BK-test', client_id: CLIENT.id, client_email: CLIENT.email, creator_id: CREATOR.id,
    project_category: 'Portrait Photography', status: 'paid', total: 3000, creator_amount: 2550,
    payment_status: 'paid', shoot_date: '2099-01-01', paystack_reference: 'BK-test', created_at: '2026-09-01T00:00:00.000Z',
    delivered_at: null, revisions_included: 1, revisions_used: 0,
    ...over,
  }];
}

const call = async (as: { id: string; email: string } | null, body: unknown) => {
  sessionUser = as;
  const req = new NextRequest('http://localhost/api/service-bookings/b-1/status', { method: 'PATCH', body: JSON.stringify(body) });
  const res = await PATCH(req, { params: Promise.resolve({ id: ID }) });
  return { status: res.status, json: (await res.json()) as Row };
};

const bookingUpdates = () => writes.filter((w) => w.table === 'bookings' && w.op === 'update');

beforeEach(() => {
  refundPayment.mockClear();
  sendEmail.mockClear();
  notifyClient.mockClear();
  triggerCreatorPayout.mockClear();
  failNextBookingUpdateWith = null;
});

describe('creator decline (the Decline button used to fail with a 400)', () => {
  it('the old button value (status: cancelled) now declines, refunds in full and alerts the team', async () => {
    seed();
    const r = await call(CREATOR, { status: 'cancelled' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'declined', action: 'decline', refund_status: 'refunded' });
    expect(refundPayment).toHaveBeenCalledWith('BK-test', 3000);
    expect(tables.bookings[0]).toMatchObject({ status: 'declined', payment_status: 'refunded', cancellation_refund_status: 'refunded' });
    // Compare-and-set on the status that was read.
    expect(bookingUpdates()[0].filters).toEqual(expect.arrayContaining([['id', ID], ['status', 'paid']]));
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/Creator declined/) }));
    expect(notifyClient).toHaveBeenCalledWith(expect.objectContaining({ type: 'booking_rejected' }));
    expect(tables.service_booking_events?.[0]).toMatchObject({ event: 'decline', from_status: 'paid', to_status: 'declined', actor: 'creator' });
  });

  it('before migration 073 a decline is recorded as a cancellation, still refunded', async () => {
    seed();
    failNextBookingUpdateWith = { message: 'new row for relation "bookings" violates check constraint "bookings_status_check"', code: '23514' };
    const r = await call(CREATOR, { action: 'decline', reason: 'ill' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('cancelled');
    expect(tables.bookings[0]).toMatchObject({ status: 'cancelled', cancellation_reason: 'Declined by creator: ill' });
    expect(refundPayment).toHaveBeenCalledWith('BK-test', 3000);
  });

  it('a failed refund is flagged for a person, the decline still stands', async () => {
    seed();
    refundPayment.mockResolvedValueOnce({ success: false, error: 'provider down' });
    const r = await call(CREATOR, { action: 'decline' });
    expect(r.json).toMatchObject({ status: 'declined', refund_status: 'failed' });
    expect(tables.bookings[0]).toMatchObject({ status: 'declined', payment_status: 'paid', cancellation_refund_status: 'failed' });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/AUTOMATIC REFUND FAILED/) }));
  });

  it('cannot decline once accepted', async () => {
    seed({ status: 'accepted' });
    const r = await call(CREATOR, { action: 'decline' });
    expect(r.status).toBe(400);
    expect(refundPayment).not.toHaveBeenCalled();
  });
});

describe('client acceptance', () => {
  it('approving records acceptance and the payout due time, and pays nothing now', async () => {
    seed({ status: 'delivered', delivered_at: '2026-10-08T00:00:00.000Z' });
    const before = Date.now();
    const r = await call(CLIENT, { status: 'completed' });
    expect(r.status).toBe(200);
    expect(triggerCreatorPayout).not.toHaveBeenCalled();
    const b = tables.bookings[0];
    expect(b.status).toBe('completed');
    expect(b.accepted_by_client_at).toBeTruthy();
    const due = new Date(String(b.payout_due_at)).getTime() - new Date(String(b.completed_at)).getTime();
    expect(due).toBe(72 * 3_600_000);
    expect(new Date(String(b.completed_at)).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(b.dispute_window_ends_at).toBe(b.payout_due_at);
    expect(r.json.payout_due_at).toBe(b.payout_due_at);
  });

  it('a revision request sends it back to the creator, once', async () => {
    seed({ status: 'delivered', delivered_at: '2026-10-08T00:00:00.000Z' });
    const r = await call(CLIENT, { action: 'request_revision', reason: 'Please brighten the group shots' });
    expect(r.status).toBe(200);
    expect(tables.bookings[0]).toMatchObject({ status: 'accepted', revisions_used: 1, delivered_at: null });
    expect(tables.notifications?.[0]).toMatchObject({ user_id: CREATOR.id, type: 'gig_revision_requested' });

    tables.bookings[0].status = 'delivered';
    const again = await call(CLIENT, { action: 'request_revision', reason: 'More changes' });
    expect(again.status).toBe(400);
    expect(again.json.code).toBe('revisions_exhausted');
  });

  it('a revision request needs a reason', async () => {
    seed({ status: 'delivered' });
    const r = await call(CLIENT, { action: 'request_revision' });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('reason_required');
  });
});

describe('guards', () => {
  it('only the parties may act', async () => {
    seed();
    expect((await call(null, { action: 'accept' })).status).toBe(401);
    expect((await call({ id: 'stranger', email: 's@example.invalid' }, { action: 'accept' })).status).toBe(403);
  });

  it('delivery goes through the deliver step (it needs a link)', async () => {
    seed({ status: 'accepted' });
    expect((await call(CREATOR, { status: 'delivered' })).status).toBe(400);
  });

  it('a lost race is a 409, not a silent overwrite', async () => {
    seed();
    // The row moves on between the read and the write.
    const realFrom = client.from;
    let reads = 0;
    client.from = (t: string) => {
      const b = realFrom(t);
      if (t === 'bookings') {
        const origMaybe = b.maybeSingle;
        b.maybeSingle = async () => { const r = await origMaybe(); reads++; if (reads === 1) tables.bookings[0].status = 'accepted'; return r; };
      }
      return b;
    };
    const r = await call(CREATOR, { action: 'accept' });
    client.from = realFrom;
    expect(r.status).toBe(409);
  });
});

describe('a failed service payment never cancels or corrupts the booking', () => {
  it('writes no status and no invalid payment_status; records the attempt', async () => {
    seed({ status: 'pending', payment_status: 'unpaid', paystack_reference: null });
    const { handlePaymentFailed } = await import('@/lib/payments/fulfil');
    const webhook = {
      paymentId: 'BK-test', providerPaymentId: 'ps_1', status: 'FAILED', amountGross: 3000, amountFee: 0, amountNet: 3000,
      raw: { custom_str1: 'service_booking', custom_str2: ID },
    } as unknown as WebhookResult;
    await handlePaymentFailed(webhook);
    expect(bookingUpdates()).toHaveLength(0);
    expect(tables.bookings[0]).toMatchObject({ status: 'pending', payment_status: 'unpaid' });
    expect(tables.service_booking_events?.[0]).toMatchObject({ event: 'payment_failed', actor: 'system' });
  });
});

describe('transfer webhooks work with the stable reference and old in-flight ones', () => {
  it('success marks paid and paid_out, for both reference styles; repeats are no-ops', async () => {
    const { handleServiceTransferEvent } = await import('@/lib/payments/service-transfers');
    for (const ref of ['tvsp_b1', 'payout-BK-test-lzx1']) {
      seed({ status: 'completed', payout_status: 'processing', payout_reference: ref });
      await handleServiceTransferEvent('transfer.success', ref);
      expect(tables.bookings[0]).toMatchObject({ status: 'paid_out', payout_status: 'paid' });
      const n = bookingUpdates().length;
      await handleServiceTransferEvent('transfer.success', ref);
      expect(bookingUpdates()).toHaveLength(n);
    }
  });

  it('failure marks it failed and tells a person; it is not re-sent here', async () => {
    const { handleServiceTransferEvent } = await import('@/lib/payments/service-transfers');
    seed({ status: 'completed', payout_status: 'processing', payout_reference: 'tvsp_b1' });
    await handleServiceTransferEvent('transfer.failed', 'tvsp_b1');
    expect(tables.bookings[0]).toMatchObject({ status: 'completed', payout_status: 'failed', payout_reference: 'tvsp_b1' });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/payout failed/) }));
  });

  it('a reversal after success re-opens it; a late failure after success is ignored', async () => {
    const { handleServiceTransferEvent } = await import('@/lib/payments/service-transfers');
    seed({ status: 'paid_out', payout_status: 'paid', payout_reference: 'tvsp_b1' });
    await handleServiceTransferEvent('transfer.failed', 'tvsp_b1');
    expect(tables.bookings[0]).toMatchObject({ status: 'paid_out', payout_status: 'paid' });
    await handleServiceTransferEvent('transfer.reversed', 'tvsp_b1');
    expect(tables.bookings[0]).toMatchObject({ status: 'completed', payout_status: 'failed' });
  });
});
