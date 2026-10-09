/**
 * Review fix round 2, finding 3: staff can cancel a booking whose delivery
 * already reached the renter (or is lost, damaged or under review). Only a
 * leg actually in motion blocks them. Legs left as they are keep their fee
 * (D-39/D-52) unless staff explicitly refund it, once. The renter keeps the
 * stricter rule (tested in delivery-checkout-cancel.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { commitDelivery, confirmHandover, deliveryFeeRefundKey, markDeliveryQuotesPaid, prepareDelivery, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, STAFF, world, type World } from './helpers/delivery-fakes';

const BK = '00000000-0000-4000-8000-0000000bb001';
const h = vi.hoisted(() => ({
  w: null as unknown as World,
  transitions: [] as Record<string, unknown>[],
  plan: null as unknown as Record<string, unknown>,
  events: [] as Record<string, unknown>[],
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
vi.mock('@/lib/data/events', () => ({ logEvent: (e: Record<string, unknown>) => h.events.push(e) }));
vi.mock('@/lib/payments/ports', () => ({ paymentPort: {} }));

const staff = { kind: 'staff' as const, userId: STAFF };
const photo = (ref: string) => [{ kind: 'photo' as const, ref: `https://res.cloudinary.com/demo/${ref}.jpg` }];

/** A paid own-vehicle outbound leg our driver handed over; the renter accepted it (fee earned). */
async function deliveredLeg(w: World, accepted = true) {
  const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T06:00:00Z', end: '2026-10-20T10:00:00Z' } }, w.deps);
  if (!q.ok) throw new Error(q.code);
  await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
  const p = await prepareDelivery({ caller: { kind: 'system' }, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  for (const i of w.repo.shipments.get(p.shipment.id)!.items) {
    await confirmHandover({ caller: staff, shipmentId: p.shipment.id, bookingId: i.bookingId, rentalId: i.rentalId, evidence: photo(i.rentalId), outcome: 'delivered' }, w.deps);
    if (accepted) await confirmHandover({ caller: { kind: 'renter', userId: RENTER }, shipmentId: p.shipment.id, bookingId: i.bookingId, rentalId: i.rentalId, evidence: [], outcome: 'accepted' }, w.deps);
  }
  expect(w.repo.shipments.get(p.shipment.id)?.status).toBe('delivered');
  return { shipmentId: p.shipment.id, fee: q.quotes[0].customerFeeCents };
}

async function staffCancel(extra: Record<string, unknown> = {}) {
  const { PATCH } = await import('@/app/api/admin/equipment-bookings/[id]/route');
  const res = await PATCH(
    new NextRequest(`http://localhost/api/admin/equipment-bookings/${BK}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', reason: 'hire ended early by agreement', refundCents: 0, ...extra }) }),
    { params: Promise.resolve({ id: BK }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const plan = (extra: Record<string, unknown>) => ({ phase4: true, lastLine: true, shipmentIds: [], tooLate: false, inMotion: false, keptShipmentIds: [], feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [], ...extra });

describe('finding 3: staff cancel after the gear reached the renter', () => {
  beforeEach(() => {
    h.transitions = [];
    h.events = [];
    h.w = world({ providers: 'manual' });
  });

  it('a delivered leg does not block staff (the renter rule would): booking cancelled, leg untouched, fee kept, logged', async () => {
    const { shipmentId } = await deliveredLeg(h.w);
    h.plan = plan({ tooLate: true, inMotion: false, keptShipmentIds: [shipmentId] });
    const r = await staffCancel();
    expect(r.status).toBe(200);
    expect(h.transitions).toHaveLength(1);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('delivered');
    expect(h.w.repo.refunds.size).toBe(0);
    expect(h.events.at(-1)).toMatchObject({ eventType: 'admin_booking_transition', metadata: { deliveryRefundCents: 0, deliveryLegsLeft: 1, deliveryFeeRefundAsked: false } });
  });

  it('staff tick "refund the delivery fee": refunded once, the earned income reversed, the leg still delivered', async () => {
    const { shipmentId, fee } = await deliveredLeg(h.w);
    h.plan = plan({ tooLate: true, inMotion: false, keptShipmentIds: [shipmentId] });
    const r = await staffCancel({ refundDeliveryFee: true });
    expect(r.status).toBe(200);
    expect(h.w.repo.refunds.get(deliveryFeeRefundKey(shipmentId))?.amountCents).toBe(fee);
    const j = h.w.repo.journals.get(`delivery-cancel:${shipmentId}`);
    expect(j?.lines.find((l) => l.account === 'delivery_income')?.debitCents).toBe(fee);
    expect(j?.lines.some((l) => l.account === 'unearned_hire')).toBe(false);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('delivered');
    // A second cancellation request refunds nothing more.
    await staffCancel({ refundDeliveryFee: true });
    expect(h.w.repo.refunds.size).toBe(1);
  });

  it('a leg in motion (gear with the driver) still blocks staff: 409 and nothing changes', async () => {
    const { shipmentId } = await deliveredLeg(h.w, false);
    h.plan = plan({ tooLate: true, inMotion: true });
    const r = await staffCancel();
    expect(r).toMatchObject({ status: 409, body: { code: 'DELIVERY_UNDER_WAY' } });
    expect(h.transitions).toHaveLength(0);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('delivered');
  });
});

describe('deliveryCancellationPlan: the renter rule and the staff rule', () => {
  it('a delivered outbound leg is too late for the renter, not in motion for staff, and left as it is; a scheduled return leg is cancelled', async () => {
    const { deliveryCancellationPlan } = await vi.importActual<typeof import('@/lib/rental/delivery-settlement')>('@/lib/rental/delivery-settlement');
    const w = world({ providers: 'manual' });
    const { shipmentId } = await deliveredLeg(w, false);
    const ret = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: { start: '2026-10-22T10:00:00Z', end: '2026-10-22T15:00:00Z' } }, w.deps);
    if (!ret.ok) throw new Error(ret.code);
    w.repo.quotes.get(ret.quotes[0].id)!.customerFeeCents = 0;
    w.bookings.setStatus(GROUP, 'active');
    const p = await prepareDelivery({ caller: { kind: 'system' }, quoteId: ret.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    const fake = {
      from(table: string) {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'limit']) b[m] = () => b;
        b.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: table === 'equipment_bookings' ? [{ id: 'bk-1', status: 'active' }] : table === 'delivery_shipments' ? [{ id: shipmentId }] : [], error: null }).then(resolve);
        return b;
      },
    };
    const r = await deliveryCancellationPlan(fake as never, { bookingGroupId: GROUP, bookingId: 'bk-1' }, w.repo);
    expect(r).toMatchObject({ phase4: true, lastLine: true, tooLate: true, inMotion: false, keptShipmentIds: [shipmentId], shipmentIds: [p.shipment.id] });
    // Our driver is on the way back with it: in motion for everyone.
    w.repo.shipments.get(p.shipment.id)!.status = 'in_transit';
    expect(await deliveryCancellationPlan(fake as never, { bookingGroupId: GROUP, bookingId: 'bk-1' }, w.repo)).toMatchObject({ tooLate: true, inMotion: true, shipmentIds: [] });
  });
});
