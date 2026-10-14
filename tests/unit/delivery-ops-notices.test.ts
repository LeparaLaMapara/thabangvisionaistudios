/**
 * Spec Phase 4 §4.19: every one of the 15 delivery notice kinds is queued
 * by a real underlying event (a verified provider update, a staff action,
 * a renter or owner confirmation, a scheduled pickup coming up, a quote
 * obtained for the renter), with a dedupe key, and none carries an address.
 *
 * Thirteen come from the core use cases; `delivery_return_reminder` from the
 * daily job (lib/delivery/jobs.ts) and `delivery_quote_ready` from a staff
 * quote (lib/delivery/ops.ts, used by the admin route).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { RENTAL_NOTICE_KINDS, type OutboxMessage } from '@/lib/core/rental/notifications';
import {
  advanceManualDelivery,
  cancelDelivery,
  commitDelivery,
  confirmCollection,
  confirmHandover,
  markDeliveryQuotesPaid,
  prepareDelivery,
  quoteDelivery,
  recordProviderEvent,
  reportIncident,
} from '@/lib/core/delivery/use-cases';
import { remindReturnPickups } from '@/lib/delivery/jobs';
import { quoteReadyNotices } from '@/lib/delivery/ops';
import { GROUP, LINES_FOR_QUOTE, OFFICE, OWNER_A, RENTER, RENTER_HOME, STAFF, world } from './helpers/delivery-fakes';

const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const photo = (n: string) => [{ kind: 'photo' as const, ref: `https://res.cloudinary.com/demo/image/upload/${n}.jpg` }];

describe('§4.19 - all 15 delivery notices come from real events', () => {
  it('outbound by courier, return by our driver, a cancellation with refund, a staff quote', async () => {
    const all: OutboxMessage[] = [];

    // ── Outbound by courier (paid) ──
    const w = world({ courierEnabled: true, providers: 'both', cover: { fake_courier: 2_000_000 } });
    w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' } }, w.deps);
    if (!q.ok) throw new Error('quote');
    const courierQuote = q.quotes.find((x) => x.providerId === 'fake_courier')!;
    const p = await prepareDelivery({ caller: renter, quoteId: courierQuote.id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    await markDeliveryQuotesPaid({ paymentReference: 'pay-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [courierQuote.id], paidDeliveryCents: courierQuote.customerFeeCents }, w.deps);
    expect(await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps)).toMatchObject({ ok: true }); // delivery_booked
    const ref = p.shipment.merchantReference;
    const evt = (state: Parameters<typeof recordProviderEvent>[0]['state'], at: string) =>
      recordProviderEvent({ providerId: 'fake_courier', verified: true, dedupeKey: `wh:${state}:${at}`, merchantReference: ref, providerReference: null, state, stateAt: at, source: 'provider_webhook' }, w.deps);
    for (const [state, at] of [
      ['courier_assigned', '06:40'],
      ['courier_at_pickup', '07:00'],
      ['collected', '07:05'],
      ['in_transit', '07:10'],
      ['courier_at_dropoff', '07:40'],
      ['delivery_attempt_failed', '07:45'],
      ['in_transit', '08:10'],
      ['delivered', '08:30'],
    ] as const) {
      expect(await evt(state, `2026-10-20T${at}:00Z`)).toBe('applied');
    }
    // Replays queue nothing new (dedupe).
    const size = w.repo.outbox.size;
    expect(await evt('delivered', '2026-10-20T08:30:00Z')).toBe('duplicate');
    expect(w.repo.outbox.size).toBe(size);
    // The renter reports a problem with one item: delivery_incident.
    await confirmHandover({ caller: renter, shipmentId: p.shipment.id, bookingId: 'bk-1', rentalId: 'cam-1', outcome: 'accepted', evidence: [], serialConfirmed: true }, w.deps);
    await confirmHandover({ caller: renter, shipmentId: p.shipment.id, bookingId: 'bk-2', rentalId: 'lens-1', outcome: 'exception', evidence: photo('scratch'), discrepancies: ['Lens cap missing'] }, w.deps);

    // ── Return by our own driver ──
    w.bookings.setStatus(GROUP, 'active');
    const rq = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: { start: '2026-10-11T07:00:00Z', end: '2026-10-11T09:00:00Z' } }, w.deps);
    if (!rq.ok) throw new Error('return quote');
    const ownQuote = rq.quotes.find((x) => x.providerKind === 'own_fleet')!;
    w.repo.quotes.get(ownQuote.id)!.customerFeeCents = 0;
    const rp = await prepareDelivery({ caller: renter, quoteId: ownQuote.id, bookingGroupId: GROUP }, w.deps);
    if (!rp.ok) throw new Error(rp.code);
    await commitDelivery({ caller: staff, shipmentId: rp.shipment.id }, w.deps);
    await remindReturnPickups(w.deps, { listUpcomingReturnPickups: async () => [w.repo.shipments.get(rp.shipment.id)!] }); // delivery_return_reminder
    expect(await advanceManualDelivery({ caller: staff, shipmentId: rp.shipment.id, state: 'courier_assigned' }, w.deps)).toBe('applied');
    for (const [bookingId, rentalId] of [['bk-1', 'cam-1'], ['bk-2', 'lens-1']] as const) {
      await confirmCollection({ caller: renter, shipmentId: rp.shipment.id, bookingId, rentalId, evidence: photo(`r-${rentalId}`) }, w.deps);
      await confirmCollection({ caller: staff, shipmentId: rp.shipment.id, bookingId, rentalId, evidence: photo(`s-${rentalId}`) }, w.deps);
    }
    await advanceManualDelivery({ caller: staff, shipmentId: rp.shipment.id, state: 'in_transit' }, w.deps);
    await confirmHandover({ caller: { kind: 'owner', userId: OWNER_A }, shipmentId: rp.shipment.id, bookingId: 'bk-1', rentalId: 'cam-1', outcome: 'received', evidence: photo('a2') }, w.deps);
    await confirmHandover({ caller: staff, shipmentId: rp.shipment.id, bookingId: 'bk-2', rentalId: 'lens-1', outcome: 'received', evidence: photo('b2') }, w.deps);
    all.push(...w.repo.outbox.values());

    // ── A paid own-fleet leg cancelled by staff: cancellation + fee refund ──
    const w2 = world({ providers: 'manual' });
    const q2 = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' } }, w2.deps);
    if (!q2.ok) throw new Error('quote 2');
    const p2 = await prepareDelivery({ caller: renter, quoteId: q2.quotes[0].id, bookingGroupId: GROUP }, w2.deps);
    if (!p2.ok) throw new Error(p2.code);
    await markDeliveryQuotesPaid({ paymentReference: 'pay-2', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q2.quotes[0].id], paidDeliveryCents: q2.quotes[0].customerFeeCents }, w2.deps);
    expect(q2.quotes[0].customerFeeCents).toBeGreaterThan(0);
    expect(await cancelDelivery({ caller: staff, shipmentId: p2.shipment.id, reason: 'Renter will collect' }, w2.deps)).toMatchObject({ ok: true });
    // And a staff-reported incident on its own (also delivery_incident).
    await reportIncident({ caller: staff, shipmentId: p2.shipment.id, kind: 'delayed', description: 'Driver could not get there' }, w2.deps);
    all.push(...w2.repo.outbox.values());

    // ── A quote obtained for the renter by staff ──
    all.push(...quoteReadyNotices(RENTER, ownQuote));

    const kinds = new Set(all.map((n) => n.kind));
    const wanted = RENTAL_NOTICE_KINDS.filter((k) => k.startsWith('delivery_'));
    expect(wanted).toHaveLength(16); // 15 + the one "on the way" email (2026-10-14)
    for (const k of wanted) expect([k, kinds.has(k)]).toEqual([k, true]);

    // Owners hear about the pickup of their own gear; data never holds an address.
    expect(all.some((n) => n.kind === 'delivery_courier_at_pickup' && n.userId === OWNER_A)).toBe(true);
    for (const n of all) {
      expect(Object.keys(n.data).every((k) => ['amountCents', 'what', 'reference'].includes(k))).toBe(true);
      expect(JSON.stringify(n)).not.toMatch(/Test Road|Smith Street|Sandton|Gate 2/);
    }
    // Every notice has its own dedupe key.
    for (const repo of [w.repo, w2.repo]) expect(new Set([...repo.outbox.values()].map((n) => n.dedupeKey)).size).toBe(repo.outbox.size);
  });
});
