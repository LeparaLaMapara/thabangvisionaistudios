/**
 * What the renter sees and arranges after checkout (spec §4.17, §4.12):
 * only recorded provider/staff facts (nothing invented), tracking only when
 * the provider gave a link, and a return pickup only when the gear went out
 * by delivery (D-44), at a price the renter approves (D07, D08).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { customerLegs, deliveryStatusLabel, returnPickupOption, safeTrackingUrl } from '@/lib/delivery/customer-view';
import { commitDelivery, markDeliveryQuotesPaid, prepareDelivery, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world, type World } from './helpers/delivery-fakes';

describe('customer view of a delivery', () => {
  it('never invents a courier, and shows a tracking link only when the provider gave one', () => {
    const legs = customerLegs(
      [{ shipmentId: 's1', leg: 'outbound', status: 'scheduled', providerId: 'manual', trackingUrl: null, courierName: null, scheduledAt: null, items: [{ bookingId: 'b', rentalId: 'r', receipt: 'not_sent' }] }],
      [],
    );
    expect(legs[0]).toMatchObject({ courier_name: null, tracking_url: null, status_label: 'Scheduled' });
    expect(safeTrackingUrl('javascript:alert(1)')).toBeNull();
    expect(safeTrackingUrl('http://track.example/x')).toBeNull();
    expect(safeTrackingUrl('https://track.example/x')).toBe('https://track.example/x');
    expect(JSON.stringify(legs)).not.toMatch(/address|lat|lng/i);
  });

  it('labels say what happened, per leg', () => {
    expect(deliveryStatusLabel('outbound', 'delivered')).toBe('Delivered');
    expect(deliveryStatusLabel('return', 'delivered')).toBe('Back with us');
    expect(deliveryStatusLabel('outbound', 'lost')).toMatch(/review/i);
  });

  it('D-44: gear collected in person is returned in person', () => {
    expect(returnPickupOption([], ['active'])).toMatchObject({ allowed: false, reason: 'collected_in_person' });
    expect(returnPickupOption([{ leg: 'outbound', status: 'cancelled' }], ['active'])).toMatchObject({ allowed: false, reason: 'collected_in_person' });
    expect(returnPickupOption([{ leg: 'outbound', status: 'delivered' }], ['active'])).toEqual({ allowed: true });
    expect(returnPickupOption([{ leg: 'outbound', status: 'delivered' }, { leg: 'return', status: 'scheduled' }], ['active'])).toMatchObject({ allowed: false, reason: 'already_arranged' });
    expect(returnPickupOption([{ leg: 'outbound', status: 'delivered' }], ['completed'])).toMatchObject({ allowed: false, reason: 'not_during_hire' });
  });
});

// ── POST /api/delivery/return-pickup ─────────────────────────────────────────

const BK = '00000000-0000-4000-8000-0000000bb001';
const h = vi.hoisted(() => ({ w: null as unknown as World }));

vi.mock('@/lib/supabase/server', () => {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: { id: '00000000-0000-4000-8000-0000000bb001', checkout_group_id: '00000000-0000-4000-8000-0000000000d1' }, error: null });
  return {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-0000000000a1' } } }) }, from: () => b }),
    createAdminClient: () => ({}),
  };
});
vi.mock('@/lib/auth', () => ({ checkNotSuspended: async () => ({ suspended: false }), checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/delivery/server', () => ({ deliveryDeps: async () => h.w.deps }));

async function delivered(w: World) {
  const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T06:00:00Z', end: '2026-10-20T10:00:00Z' } }, w.deps);
  if (!q.ok) throw new Error(q.code);
  await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
  const p = await prepareDelivery({ caller: { kind: 'system' }, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  w.bookings.setStatus(GROUP, 'active');
}

async function pickup(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/delivery/return-pickup/route');
  const res = await POST(new NextRequest('http://localhost/api/delivery/return-pickup', { method: 'POST', body: JSON.stringify({ booking_id: BK, ...body }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { quote?: { id: string; customer_fee_cents: number } } };
}

describe('return pickup during the hire', () => {
  beforeEach(() => {
    h.w = world({ providers: 'manual' });
  });

  it('not offered when the gear was collected in person (D-44)', async () => {
    h.w.bookings.setStatus(GROUP, 'active');
    expect(await pickup({ action: 'quote', window: 'afternoon' })).toMatchObject({ status: 409, body: { code: 'collected_in_person' } });
  });

  it('quotes from the delivered address, needs the exact approved price, and is never dispatched unpaid', async () => {
    await delivered(h.w);
    const q = await pickup({ action: 'quote', window: 'afternoon' });
    expect(q.status).toBe(201);
    const quote = q.body.quote as { id: string; customer_fee_cents: number };
    const stored = h.w.repo.quotes.get(quote.id);
    expect(stored).toMatchObject({ leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, bookingGroupId: GROUP });

    // D08: a different number is refused.
    expect(await pickup({ action: 'approve', quote_id: quote.id, approved_cents: quote.customer_fee_cents - 1 })).toMatchObject({ status: 409, body: { code: 'DELIVERY_PRICE_CHANGED' } });
    // Approved at the stored price: a request for staff, no return leg until it is paid.
    const ok = await pickup({ action: 'approve', quote_id: quote.id, approved_cents: quote.customer_fee_cents });
    expect(ok.body).toMatchObject({ ok: true, requested: true });
    expect((await h.w.repo.listShipments(GROUP)).filter((s) => s.leg === 'return')).toHaveLength(0);
    expect([...h.w.repo.outbox.values()].some((n) => n.userId === 'staff' && (n.data as { what?: string }).what === 'delivery_return_pickup_requested')).toBe(true);
  });

  it('D07: an expired pickup quote is re-quoted and must be approved again', async () => {
    await delivered(h.w);
    const q = await pickup({ action: 'quote', window: 'morning' });
    const quote = q.body.quote as { id: string; customer_fee_cents: number };
    h.w.clock.advanceMinutes(31);
    const r = await pickup({ action: 'approve', quote_id: quote.id, approved_cents: quote.customer_fee_cents });
    expect(r).toMatchObject({ status: 409, body: { code: 'DELIVERY_REQUOTE' } });
    expect((r.body.quote as { id: string }).id).not.toBe(quote.id);
    expect(h.w.repo.quotes.get(quote.id)?.status).toBe('superseded');
  });
});
