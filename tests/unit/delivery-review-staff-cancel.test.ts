/**
 * Finding 2: a staff cancellation of a booking with Phase 4 delivery.
 *  - the line releases its hire and deposit only: the delivery fee is never
 *    added to what staff can refund or what the line releases (its legs settle
 *    it once, through the delivery core);
 *  - the order's live legs are cancelled through cancelDelivery as staff
 *    (a platform cancellation: the fee is refunded in full, once);
 *  - a leg already on its way: 409, nothing changes;
 *  - legacy orders (no Phase 4 delivery) keep their behaviour.
 * Mutation-checked: adding the fee back into heldForStaffCancel for Phase 4
 * orders, or dropping the leg cancellation, fails these tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { commitDelivery, deliveryFeeRefundKey, markDeliveryQuotesPaid, prepareDelivery, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world, type World } from './helpers/delivery-fakes';

const BK = '00000000-0000-4000-8000-0000000bb001';
const h = vi.hoisted(() => ({
  w: null as unknown as World,
  transitions: [] as Record<string, unknown>[],
  plan: null as unknown as Record<string, unknown>,
}));

const BOOKING = { id: '00000000-0000-4000-8000-0000000bb001', user_id: '00000000-0000-4000-8000-0000000000a1', status: 'confirmed', checkout_group_id: '00000000-0000-4000-8000-0000000000d1', payfast_payment_id: 'T_provider_1', deposit_amount: 2500 };

function db() {
  return {
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      let cols = '';
      const b: Record<string, unknown> = {};
      for (const m of ['eq', 'in', 'is', 'not', 'order', 'limit', 'neq', 'update', 'insert', 'maybeSingle', 'single']) b[m] = () => b;
      b.select = (c: string) => {
        cols = c ?? '';
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null;
        if (table === 'equipment_bookings') {
          // One line, 100 000 hire + 250 000 deposit; the legacy column still carries the R120 delivery fee.
          data = cols.includes('hire_cents') ? [{ id: BOOKING.id, status: 'confirmed', hire_cents: 100_000, deposit_cents: 250_000, delivery_fee: 120 }] : BOOKING;
        } else if (table === 'rental_payment_intents') data = { state: 'paid', expected_amount_cents: 362_000 };
        else if (table === 'refund_obligations') data = cols.includes('amount_cents') ? [] : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return b;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => db(), createClient: async () => db() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: async () => ({ user: { id: '00000000-0000-4000-8000-0000000000c1' } }), rateLimitAdmin: async () => null }));
vi.mock('@/lib/rental/repos', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/repos')>()),
  transitionBookings: async (_db: unknown, t: Record<string, unknown>) => {
    h.transitions.push(t);
    return { result: 'moved' };
  },
  SupabaseRefunds: class {},
}));
vi.mock('@/lib/rental/delivery-settlement', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/delivery-settlement')>()),
  deliveryCancellationPlan: async () => h.plan,
}));
vi.mock('@/lib/delivery/server', () => ({ deliveryDeps: async () => h.w.deps }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: async () => undefined }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/payments/ports', () => ({ paymentPort: {} }));

async function paidLeg(w: World) {
  const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T06:00:00Z', end: '2026-10-20T10:00:00Z' } }, w.deps);
  if (!q.ok) throw new Error(q.code);
  await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
  const p = await prepareDelivery({ caller: { kind: 'system' }, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  return { shipmentId: p.shipment.id, fee: q.quotes[0].customerFeeCents };
}

async function staffCancel(refundCents: number) {
  const { PATCH } = await import('@/app/api/admin/equipment-bookings/[id]/route');
  const res = await PATCH(new NextRequest(`http://localhost/api/admin/equipment-bookings/${BK}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', reason: 'customer phoned to cancel', refundCents }) }), {
    params: Promise.resolve({ id: BK }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const plan = (extra: Record<string, unknown>) => ({ phase4: true, lastLine: true, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [], ...extra });
const releasedHire = (): number => {
  const j = (h.transitions[0].journals as { lines: { account: string; debitCents: number }[] }[])[0];
  return j.lines.find((l) => l.account === 'unearned_hire')?.debitCents ?? 0;
};

describe('staff cancel with Phase 4 delivery (finding 2)', () => {
  beforeEach(() => {
    h.transitions = [];
    h.w = world({ providers: 'manual' });
  });

  it('releases hire + deposit only; the leg is cancelled once through the core with the fee refunded in full', async () => {
    const { shipmentId, fee } = await paidLeg(h.w);
    h.plan = plan({ shipmentIds: [shipmentId], feeCents: fee });
    const r = await staffCancel(350_000);
    expect(r.status).toBe(200);
    expect(releasedHire()).toBe(100_000);
    const refunds = h.transitions[0].refunds as { amountCents: number }[];
    expect(refunds[0].amountCents).toBe(350_000);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('cancelled');
    expect(h.w.repo.refunds.get(deliveryFeeRefundKey(shipmentId))?.amountCents).toBe(fee);
    // One delivery-cancel journal, one fee refund: never twice.
    expect([...h.w.repo.journals.keys()].filter((k) => k.startsWith('delivery-cancel:'))).toEqual([`delivery-cancel:${shipmentId}`]);
    expect(h.w.repo.refunds.size).toBe(1);
  });

  it('staff cannot fold the delivery fee into the booking refund', async () => {
    const { shipmentId, fee } = await paidLeg(h.w);
    h.plan = plan({ shipmentIds: [shipmentId], feeCents: fee });
    const r = await staffCancel(350_000 + 12_000);
    expect(r).toMatchObject({ status: 400, body: { code: 'REFUND_TOO_LARGE' } });
    expect(h.transitions).toHaveLength(0);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('scheduled');
  });

  it('a leg already on its way: 409 DELIVERY_UNDER_WAY and nothing changes', async () => {
    const { shipmentId } = await paidLeg(h.w);
    h.plan = plan({ shipmentIds: [shipmentId], tooLate: true });
    const r = await staffCancel(350_000);
    expect(r).toMatchObject({ status: 409, body: { code: 'DELIVERY_UNDER_WAY' } });
    expect(h.transitions).toHaveLength(0);
    expect(h.w.repo.refunds.size).toBe(0);
  });

  it('legacy order (no Phase 4 delivery): the line still releases the order’s delivery fee as before', async () => {
    h.plan = plan({ phase4: false, lastLine: false });
    const r = await staffCancel(362_000);
    expect(r.status).toBe(200);
    expect(releasedHire()).toBe(100_000 + 12_000);
  });
});
