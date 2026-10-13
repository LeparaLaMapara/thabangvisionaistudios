/**
 * A renter cancels a booking with Phase 4 delivery (D-39, D23):
 *  - the delivery legs are cancelled through cancelDelivery;
 *  - the fee is refunded in full, unless a courier was already booked: then
 *    the courier's cancellation fee is passed on at cost, capped at the fee;
 *  - the delivery fee is never refunded a second time with the hire;
 *  - gear already on its way cannot be cancelled online.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { commitDelivery, deliveryFeeRefundKey, markDeliveryQuotesPaid, prepareDelivery, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world, type World } from './helpers/delivery-fakes';

const BK = '00000000-0000-4000-8000-0000000bb001';
const h = vi.hoisted(() => ({
  w: null as unknown as World,
  transitions: [] as Record<string, unknown>[],
  plan: null as unknown as Record<string, unknown>,
}));

const BOOKING = {
  id: '00000000-0000-4000-8000-0000000bb001', user_id: '00000000-0000-4000-8000-0000000000a1', status: 'confirmed', start_date: '2030-01-10', created_at: '2026-01-01T00:00:00Z',
  total_price: 1_000, deposit_amount: 2_500, delivery_fee: 120, payment_plan: 'full', checkout_group_id: '00000000-0000-4000-8000-0000000000d1', payfast_payment_id: 'T_provider_1',
};

function db() {
  return {
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      let cols = '';
      const b: Record<string, unknown> = {};
      for (const m of ['eq', 'in', 'is', 'not', 'order', 'limit', 'contains', 'or', 'update', 'insert', 'maybeSingle', 'single']) b[m] = () => b;
      b.select = (c: string) => {
        cols = c ?? '';
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null;
        if (table === 'equipment_bookings') {
          if (cols.includes('delivery_fee') && cols.includes('quantity')) data = [{ id: BOOKING.id, quantity: 1, status: 'confirmed', delivery_fee: 120 }];
          else if (cols.includes('hire_cents')) data = { hire_cents: 100_000, deposit_cents: 250_000 };
          else data = BOOKING;
        } else if (table === 'rental_payment_intents') data = { state: 'paid', expected_amount_cents: 362_000 };
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return b;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ ...db(), auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-0000000000a1' } } }) } }),
  createAdminClient: () => db(),
}));
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
vi.mock('@/lib/payments/routing', async (orig) => ({ ...(await orig<typeof import('@/lib/payments/routing')>()), refundPayment: vi.fn() }));

const WINDOW = { start: '2030-01-10T06:00:00Z', end: '2030-01-10T10:00:00Z' };

/** A paid, dispatched outbound leg (as after checkout + payment). */
async function dispatchedLeg(w: World) {
  const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW }, w.deps);
  if (!q.ok) throw new Error(q.code);
  const quote = q.quotes[0];
  await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [quote.id], paidDeliveryCents: quote.customerFeeCents }, w.deps);
  const p = await prepareDelivery({ caller: { kind: 'system' }, quoteId: quote.id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  const c = await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  if (!c.ok) throw new Error(c.code);
  return { quote, shipmentId: p.shipment.id };
}

async function cancel() {
  const { PUT } = await import('@/app/api/bookings/[id]/route');
  const res = await PUT(new NextRequest(`http://localhost/api/bookings/${BK}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }), { params: Promise.resolve({ id: BK }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const planFor = (shipmentIds: string[], extra: Record<string, unknown> = {}) => ({ phase4: true, lastLine: true, shipmentIds, tooLate: false, feeCents: 0, courierBooked: false, ...extra });
const hireRefund = () => (h.transitions[0] as { refunds: { amountCents: number }[] }).refunds[0].amountCents;

describe('renter cancels a booking with delivery', () => {
  beforeEach(() => {
    h.transitions = [];
  });

  it('own vehicle: the delivery fee is refunded in full, once, apart from the hire', async () => {
    h.w = world({ providers: 'manual' });
    const { quote, shipmentId } = await dispatchedLeg(h.w);
    h.plan = planFor([shipmentId]);
    const r = await cancel();
    expect(r.status).toBe(200);
    expect(r.body.delivery_refund_cents).toBe(quote.customerFeeCents);
    expect(h.w.repo.refunds.get(deliveryFeeRefundKey(shipmentId))?.amountCents).toBe(quote.customerFeeCents);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('cancelled');
    // The hire refund carries hire + deposit only: the legacy delivery_fee column is not refunded again.
    expect(hireRefund()).toBe(100_000 + 250_000);
  });

  it('D-39: a booked courier’s cancellation fee is passed on at cost', async () => {
    h.w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
    h.w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
    const { quote, shipmentId } = await dispatchedLeg(h.w);
    h.w.courier.cancelFeeCents = 3_000;
    h.plan = planFor([shipmentId], { courierBooked: true });
    const r = await cancel();
    expect(r.body.delivery_refund_cents).toBe(quote.customerFeeCents - 3_000);
    expect(h.w.repo.refunds.get(deliveryFeeRefundKey(shipmentId))?.amountCents).toBe(quote.customerFeeCents - 3_000);
  });

  it('D-39: never more than the delivery fee paid (capped)', async () => {
    h.w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
    h.w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
    const { shipmentId } = await dispatchedLeg(h.w);
    h.w.courier.cancelFeeCents = 50_000;
    h.plan = planFor([shipmentId], { courierBooked: true });
    const r = await cancel();
    expect(r.body.delivery_refund_cents).toBe(0);
    expect(h.w.repo.refunds.has(deliveryFeeRefundKey(shipmentId))).toBe(false);
  });

  it('gear already on its way cannot be cancelled online (nothing changes)', async () => {
    h.w = world({ providers: 'manual' });
    const { shipmentId } = await dispatchedLeg(h.w);
    h.plan = planFor([shipmentId], { tooLate: true });
    const r = await cancel();
    expect(r).toMatchObject({ status: 409, body: { code: 'DELIVERY_UNDER_WAY' } });
    expect(h.transitions).toHaveLength(0);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('scheduled');
  });

  it('another line still booked: the delivery goes ahead and is not refunded', async () => {
    h.w = world({ providers: 'manual' });
    const { shipmentId } = await dispatchedLeg(h.w);
    h.plan = { phase4: true, lastLine: false, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false };
    const r = await cancel();
    expect(r.body.delivery_refund_cents).toBe(0);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('scheduled');
    expect(hireRefund()).toBe(100_000 + 250_000);
  });
});

describe('deliveryCancellationPlan', () => {
  it('reads the live legs of the order when the last line goes', async () => {
    const { deliveryCancellationPlan } = await vi.importActual<typeof import('@/lib/rental/delivery-settlement')>('@/lib/rental/delivery-settlement');
    const w = world({ providers: 'manual' });
    const { quote, shipmentId } = await dispatchedLeg(w);
    const fake = {
      from(table: string) {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'limit']) b[m] = () => b;
        b.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === 'equipment_bookings'
                ? [{ id: 'bk-1', status: 'confirmed' }, { id: 'bk-2', status: 'cancelled' }]
                : table === 'delivery_quotes'
                  ? [{ id: quote.id, customer_fee_cents: quote.customerFeeCents }]
                  : [{ id: shipmentId }],
            error: null,
          }).then(resolve);
        return b;
      },
    };
    const plan = await deliveryCancellationPlan(fake as never, { bookingGroupId: GROUP, bookingId: 'bk-1' }, w.repo);
    // The paid quote was used by the live leg: nothing unused to refund separately.
    expect(plan).toEqual({
      phase4: true,
      lastLine: true,
      shipmentIds: [shipmentId],
      tooLate: false,
      feeCents: quote.customerFeeCents,
      courierBooked: false,
      unusedPaidQuoteIds: [],
      // Review fix round 2: the staff rule, legs left as they are, and linked quotes nobody marked.
      inMotion: false,
      keptShipmentIds: [],
      unmarkedQuoteIds: [],
      onlineQuoteIds: [quote.id],
      paidDeliveryCents: null,
    });
    const notLast = await deliveryCancellationPlan(fake as never, { bookingGroupId: GROUP, bookingId: 'bk-2' }, w.repo);
    expect(notLast).toMatchObject({ phase4: true, lastLine: false, shipmentIds: [] });
  });
});
