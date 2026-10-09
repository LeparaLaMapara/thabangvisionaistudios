import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A service-booking dispute refund must never be sent twice: not after an
// earlier refund, and not after one whose outcome the provider left unclear.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function builder(table: string) {
  let op: 'select' | 'update' = 'select';
  let values: Row = {};
  const filters: [string, unknown][] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const run = () => {
    if (op === 'update') {
      const hit = rows().filter(match);
      hit.forEach((r) => Object.assign(r, values));
      return { data: hit, error: null };
    }
    return { data: rows().filter(match).map((r) => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    update: (v: Row) => { op = 'update'; values = v; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    in: () => b,
    maybeSingle: async () => ({ data: (run().data as Row[])[0] ?? null, error: null }),
    single: async () => { const d = run().data as Row[]; return d.length === 1 ? { data: d[0], error: null } : { data: null, error: { message: 'not one row' } }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
const client = { from: (t: string) => builder(t) };

type RefundAttempt = import('@/lib/payments/routing').RefundAttempt;
const refundWithOutcome = vi.fn<(p: { reference: string; amountRands: number; idempotencyKey: string }) => Promise<RefundAttempt>>();

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => client, createClient: async () => client }));
vi.mock('@/lib/auth', () => ({ requireAdmin: async () => ({ error: null, user: { id: 'admin-1' } }), rateLimitAdmin: async () => null }));
vi.mock('@/lib/payments/routing', () => ({ refundWithOutcome, refundPayment: vi.fn(), isManualReference: () => false }));
vi.mock('@/lib/email', () => ({ sendDisputeResolved: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/profile-email', () => ({ profileWithEmail: async () => null }));

const { PATCH } = await import('@/app/api/admin/disputes/[id]/route');

const call = (body: Row) =>
  PATCH(new NextRequest('http://localhost/api/admin/disputes/d1', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'd1' }) });

describe('admin dispute refunds on service bookings', () => {
  beforeEach(() => {
    refundWithOutcome.mockReset();
    tables.disputes = [{ id: 'd1', booking_id: 'b1', equipment_booking_id: null, filed_by: 'client-1', status: 'open' }];
    tables.bookings = [{ id: 'b1', paystack_reference: 'BK-1', total: 1000, cancellation_refund_status: null, payment_status: 'paid' }];
  });

  it('refunds once, records it, and refuses a second refund', async () => {
    refundWithOutcome.mockResolvedValue({ outcome: 'refunded', providerRefundId: 'rf_1' });
    const first = await call({ status: 'resolved', resolution: 'full_refund' });
    expect(first.status).toBe(200);
    expect(refundWithOutcome).toHaveBeenCalledWith({ reference: 'BK-1', amountRands: 1000, idempotencyKey: 'service-dispute:d1' });
    expect(tables.bookings[0]).toMatchObject({ cancellation_refund_status: 'refunded', payment_status: 'refunded', cancellation_refund_amount: 1000 });

    const again = await call({ status: 'resolved', resolution: 'full_refund' });
    expect(again.status).toBe(409);
    expect(refundWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('an unclear provider answer is recorded as unknown, leaves the dispute open and blocks a retry', async () => {
    refundWithOutcome.mockResolvedValue({ outcome: 'unknown', message: 'timeout' });
    const first = await call({ status: 'resolved', resolution: 'full_refund' });
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: 'REFUND_OUTCOME_UNKNOWN' });
    expect(tables.bookings[0]).toMatchObject({ cancellation_refund_status: 'unknown', payment_status: 'paid' });
    expect(tables.disputes[0].status).toBe('open');

    expect((await call({ status: 'resolved', resolution: 'full_refund' })).status).toBe(409);
    expect(refundWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('a partial refund above the booking total is refused before anything is sent', async () => {
    const res = await call({ status: 'resolved', resolution: 'partial_refund', resolution_amount: 1500 });
    expect(res.status).toBe(400);
    expect(refundWithOutcome).not.toHaveBeenCalled();
  });

  it('a refused refund can be tried again (nothing moved)', async () => {
    refundWithOutcome.mockResolvedValueOnce({ outcome: 'rejected', message: 'declined' });
    expect((await call({ status: 'resolved', resolution: 'partial_refund', resolution_amount: 400 })).status).toBe(502);
    expect(tables.bookings[0].cancellation_refund_status).toBe('failed');
    refundWithOutcome.mockResolvedValueOnce({ outcome: 'refunded', providerRefundId: 'rf_2' });
    expect((await call({ status: 'resolved', resolution: 'partial_refund', resolution_amount: 400 })).status).toBe(200);
    expect(tables.bookings[0]).toMatchObject({ cancellation_refund_status: 'refunded', payment_status: 'paid' });
  });
});
