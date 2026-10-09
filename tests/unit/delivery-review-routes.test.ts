/**
 * Review fixes, renter routes:
 *  - finding 3: POST /api/delivery/accept: only the booking's renter accepts
 *    or reports a problem per item; idempotent.
 *  - finding 12: a mid-hire return pickup request is recorded once and not
 *    offered again while pending.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { commitDelivery, confirmHandover, markDeliveryQuotesPaid, prepareDelivery, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, STAFF, world, type World } from './helpers/delivery-fakes';

const BK = '00000000-0000-4000-8000-0000000bb001';
const ITEM_BK = '00000000-0000-4000-8000-0000000cc001';
const ITEM_RENTAL = '00000000-0000-4000-8000-0000000cc002';
const h = vi.hoisted(() => ({ w: null as unknown as World, user: '00000000-0000-4000-8000-0000000000a1' as string | null, ownsBooking: true }));

vi.mock('@/lib/supabase/server', () => {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: h.ownsBooking ? { id: '00000000-0000-4000-8000-0000000bb001', checkout_group_id: '00000000-0000-4000-8000-0000000000d1' } : null, error: null });
  return {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user ? { id: h.user } : null } }) }, from: () => b }),
    createAdminClient: () => ({}),
  };
});
vi.mock('@/lib/auth', () => ({ checkNotSuspended: async () => ({ suspended: false }), checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: async () => undefined }));
vi.mock('@/lib/delivery/server', () => ({ deliveryDeps: async () => h.w.deps }));
vi.mock('@/lib/delivery/checkout', async (orig) => ({
  ...(await orig<typeof import('@/lib/delivery/checkout')>()),
  SupabaseQuoteLinks: class {
    async pendingReturnRequest(renterId: string, bookingIds: readonly string[]) {
      return (
        [...h.w.repo.quotes.values()].find(
          (q) => q.renterId === renterId && q.leg === 'return' && q.bookingGroupId === null && !!q.requestedAt && ['active', 'expired'].includes(q.status) && q.bookingIds.some((b) => bookingIds.includes(b)),
        ) ?? null
      );
    }
    async markRequested(quoteId: string, at: string) {
      const q = h.w.repo.quotes.get(quoteId);
      if (!q || q.requestedAt || q.status !== 'active') return false;
      q.requestedAt = at;
      return true;
    }
  },
}));

/** A paid own-vehicle outbound leg, dispatched and handed over by our driver (uuid item ids, as the route needs). */
async function delivered(w: World) {
  const g = w.bookings.groups.get(GROUP)!;
  g.lines = [{ ...g.lines[0], bookingId: ITEM_BK, rentalId: ITEM_RENTAL }];
  const lines = [{ ...LINES_FOR_QUOTE[0], bookingId: ITEM_BK, rentalId: ITEM_RENTAL }];
  const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines, window: { start: '2026-10-20T06:00:00Z', end: '2026-10-20T10:00:00Z' } }, w.deps);
  if (!q.ok) throw new Error(q.code);
  await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
  const p = await prepareDelivery({ caller: { kind: 'system' }, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  const r = await confirmHandover({ caller: { kind: 'staff', userId: STAFF }, shipmentId: p.shipment.id, bookingId: ITEM_BK, rentalId: ITEM_RENTAL, evidence: [{ kind: 'photo', ref: 'https://res.cloudinary.com/demo/d.jpg' }], outcome: 'delivered' }, w.deps);
  if (!r.ok) throw new Error(r.code);
  return { shipmentId: p.shipment.id, quote: q.quotes[0] };
}

async function accept(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/delivery/accept/route');
  const res = await POST(new NextRequest('http://localhost/api/delivery/accept', { method: 'POST', body: JSON.stringify({ booking_id: BK, ...body }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { results?: { ok: boolean; code?: string; duplicate?: boolean }[] } };
}

beforeEach(() => {
  h.w = world({ providers: 'manual' });
  h.user = RENTER;
  h.ownsBooking = true;
});

describe('POST /api/delivery/accept (finding 3)', () => {
  it('signed out → 401; not the renter’s booking → 404; nothing recorded', async () => {
    await delivered(h.w);
    h.user = null;
    expect((await accept({ items: [{ booking_id: ITEM_BK, rental_id: ITEM_RENTAL, outcome: 'accepted' }] })).status).toBe(401);
    h.user = RENTER;
    h.ownsBooking = false;
    expect((await accept({ items: [{ booking_id: ITEM_BK, rental_id: ITEM_RENTAL, outcome: 'accepted' }] })).status).toBe(404);
    expect(h.w.repo.custody.some((c) => c.kind === 'renter_accepted')).toBe(false);
  });

  it('the renter accepts: custody renter_accepted, the outbound fee is earned; a repeat changes nothing', async () => {
    const { shipmentId, quote } = await delivered(h.w);
    const r = await accept({ items: [{ booking_id: ITEM_BK, rental_id: ITEM_RENTAL, outcome: 'accepted' }] });
    expect(r.status).toBe(200);
    expect(r.body.results?.[0]).toMatchObject({ ok: true, duplicate: false });
    expect(h.w.repo.custody.filter((c) => c.kind === 'renter_accepted')).toHaveLength(1);
    expect(h.w.repo.custody.find((c) => c.kind === 'renter_accepted')?.actor).toEqual({ kind: 'renter', id: RENTER });
    expect(h.w.repo.shipments.get(shipmentId)?.acceptedAt).not.toBeNull();
    expect(h.w.repo.journals.get(`delivery:${GROUP}:outbound`)?.lines.find((l) => l.account === 'delivery_income')?.creditCents).toBe(quote.customerFeeCents);
    const again = await accept({ items: [{ booking_id: ITEM_BK, rental_id: ITEM_RENTAL, outcome: 'accepted' }] });
    expect(again.body.results?.[0]).toMatchObject({ ok: true, duplicate: true });
    expect(h.w.repo.custody.filter((c) => c.kind === 'renter_accepted')).toHaveLength(1);
  });

  it('a problem needs a description and opens an incident (leg under review), no fee earned', async () => {
    const { shipmentId } = await delivered(h.w);
    expect(await accept({ items: [{ booking_id: ITEM_BK, rental_id: ITEM_RENTAL, outcome: 'exception' }] })).toMatchObject({ status: 400, body: { code: 'exception_needs_detail' } });
    const r = await accept({ items: [{ booking_id: ITEM_BK, rental_id: ITEM_RENTAL, outcome: 'exception', kind: 'damaged', detail: 'cracked screen' }] });
    expect(r.status).toBe(200);
    expect(h.w.repo.shipments.get(shipmentId)?.status).toBe('incident_under_review');
    expect([...h.w.repo.incidents.values()][0]).toMatchObject({ kind: 'damaged', bookingIds: [ITEM_BK], providerCaused: null, liability: 'undetermined' });
    expect(h.w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(false);
  });

  it('another signed-in user cannot accept for the renter, even with the item ids', async () => {
    await delivered(h.w);
    h.user = '00000000-0000-4000-8000-0000000000a2';
    // Their own booking page resolves to the same order in this fake; the core refuses them.
    const r = await accept({ items: [{ booking_id: ITEM_BK, rental_id: ITEM_RENTAL, outcome: 'accepted' }] });
    expect(r.status).toBe(404);
    expect(h.w.repo.custody.some((c) => c.kind === 'renter_accepted')).toBe(false);
  });
});

// ── finding 12 ──────────────────────────────────────────────────────────────

async function pickup(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/delivery/return-pickup/route');
  const res = await POST(new NextRequest('http://localhost/api/delivery/return-pickup', { method: 'POST', body: JSON.stringify({ booking_id: BK, ...body }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { quote?: { id: string; customer_fee_cents: number } } };
}

describe('return pickup request during the hire (finding 12)', () => {
  it('recorded once, staff alerted once, and not offered again while pending; nothing dispatched unpaid', async () => {
    await delivered(h.w);
    h.w.bookings.setStatus(GROUP, 'active');
    const q = await pickup({ action: 'quote', window: 'afternoon' });
    expect(q.status).toBe(201);
    const quote = q.body.quote as { id: string; customer_fee_cents: number };
    const first = await pickup({ action: 'approve', quote_id: quote.id, approved_cents: quote.customer_fee_cents });
    expect(first.body).toMatchObject({ ok: true, requested: true, already: false });
    const second = await pickup({ action: 'approve', quote_id: quote.id, approved_cents: quote.customer_fee_cents });
    expect(second.body).toMatchObject({ ok: true, requested: true, already: true });
    const alerts = [...h.w.repo.outbox.values()].filter((n) => n.userId === 'staff' && (n.data as { what?: string }).what === 'delivery_return_pickup_requested');
    expect(alerts).toHaveLength(1);
    expect(await pickup({ action: 'quote', window: 'morning' })).toMatchObject({ status: 409, body: { code: 'requested' } });
    expect((await h.w.repo.listShipments(GROUP)).filter((s) => s.leg === 'return')).toHaveLength(0);
    expect(h.w.repo.quotes.get(quote.id)).toMatchObject({ bookingGroupId: null, status: 'active' });
  });
});
