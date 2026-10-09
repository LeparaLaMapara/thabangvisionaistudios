/**
 * Phase 4 delivery: provider events, chain of custody, incidents, returns and
 * the settlement guard (spec §4.9–4.13). In-memory fakes.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { chainsByItem, outboundReceipt } from '@/lib/core/delivery/custody';
import { lateFeeAutoChargeAllowed, newIncident } from '@/lib/core/delivery/incidents';
import {
  checkRentalSettlement,
  commitDelivery,
  confirmCollection,
  confirmHandover,
  markDeliveryQuotesPaid,
  prepareDelivery,
  quoteDelivery,
  recordProviderEvent,
  recordReturnInspection,
  reportIncident,
  resolveIncident,
  type ProviderEventInput,
} from '@/lib/core/delivery/use-cases';
import { InMemoryDeliveryInbox, drainDeliveryInbox, receiveDeliveryWebhook, type DeliveryWebhookParser } from '@/lib/delivery/inbox';
import { GROUP, LINES_FOR_QUOTE, OFFICE, OTHER_USER, OWNER_A, RENTER, RENTER_HOME, STAFF, world, type World } from './helpers/delivery-fakes';

const COURIER_POLICY = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
const WINDOW = { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' };
const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const ownerA = { kind: 'owner' as const, userId: OWNER_A };
const photo = [{ kind: 'photo' as const, ref: 'photos/1.jpg' }];

function courierWorld(): World {
  const w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
  w.deps.policy = COURIER_POLICY;
  return w;
}

/** A paid, dispatched leg. */
async function dispatched(w: World, leg: 'outbound' | 'return' = 'outbound') {
  if (leg === 'return') w.bookings.setStatus(GROUP, 'active');
  const q = await quoteDelivery(
    { caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg, originAddressId: leg === 'outbound' ? OFFICE : RENTER_HOME, destinationAddressId: leg === 'outbound' ? RENTER_HOME : OFFICE, lines: LINES_FOR_QUOTE, window: WINDOW },
    w.deps,
  );
  if (!q.ok) throw new Error(q.code);
  const quote = q.quotes[0];
  const p = await prepareDelivery({ caller: renter, quoteId: quote.id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  await markDeliveryQuotesPaid({ paymentReference: `pay-${leg}`, bookingGroupId: GROUP, renterId: RENTER, quoteIds: [quote.id], paidDeliveryCents: quote.customerFeeCents }, w.deps);
  const c = await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  if (!c.ok) throw new Error(c.code);
  return c.shipment;
}

const ev = (w: World, s: { merchantReference: string }, state: ProviderEventInput['state'], at: string, extra: Partial<ProviderEventInput> = {}): ProviderEventInput => ({
  providerId: w.courier.providerId,
  verified: true,
  dedupeKey: `fake:${s.merchantReference}:${state}:${at}`,
  merchantReference: s.merchantReference,
  providerReference: null,
  state,
  stateAt: at,
  source: 'provider_webhook',
  ...extra,
});

describe('provider events', () => {
  it('D11 - an invalid webhook signature is rejected: nothing stored, nothing applied', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    expect(await recordProviderEvent({ ...ev(w, s, 'collected', '2026-10-20T07:10:00Z'), verified: false }, w.deps)).toBe('rejected_unverified');
    const inbox = new InMemoryDeliveryInbox(() => w.clock.now());
    const parser: DeliveryWebhookParser = {
      providerId: w.courier.providerId,
      verify: (_body, headers) => headers['x-signature'] === 'good',
      parse: (body) => ({ ...(JSON.parse(body) as { state: 'collected' }), eventId: 'e1', merchantReference: s.merchantReference, providerReference: null, stateAt: '2026-10-20T07:10:00Z', trackingUrl: null, courierName: null, proof: [], minimal: {} }),
    };
    const bad = await receiveDeliveryWebhook({ rawBody: '{"state":"collected"}', headers: { 'x-signature': 'forged' }, parser, deps: { store: inbox, useCases: w.deps } });
    expect(bad).toEqual({ status: 401, outcome: 'invalid_signature' });
    expect(inbox.rows).toHaveLength(0);
    expect(w.repo.shipments.get(s.id)?.status).toBe('scheduled');
    const good = await receiveDeliveryWebhook({ rawBody: '{"state":"collected"}', headers: { 'x-signature': 'good' }, parser, deps: { store: inbox, useCases: w.deps } });
    expect(good).toEqual({ status: 200, outcome: 'applied' });
    // D12 at the inbox: the same webhook again is stored once and applied once.
    const again = await receiveDeliveryWebhook({ rawBody: '{"state":"collected"}', headers: { 'x-signature': 'good' }, parser, deps: { store: inbox, useCases: w.deps } });
    expect(again).toEqual({ status: 200, outcome: 'duplicate' });
    expect(inbox.rows).toHaveLength(1);
  });

  it('D12 - a duplicate webhook is processed once (custody, notices, state)', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    const e = ev(w, s, 'collected', '2026-10-20T07:10:00Z');
    expect(await recordProviderEvent(e, w.deps)).toBe('applied');
    expect(await recordProviderEvent(e, w.deps)).toBe('duplicate');
    // A second event id reporting the same state changes nothing either.
    expect(await recordProviderEvent({ ...e, dedupeKey: 'other-id' }, w.deps)).toBe('same_state');
    expect(w.repo.custody.filter((c) => c.kind === 'collected_by_courier')).toHaveLength(2); // one per item
    expect(w.repo.noticesFor(RENTER).filter((k) => k.startsWith('delivery_collected'))).toHaveLength(1);
    expect(w.repo.events.filter((x) => x.to === 'collected')).toHaveLength(1);
  });

  it('D12 - a processing failure is retried with back-off and applied exactly once', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    const inbox = new InMemoryDeliveryInbox(() => w.clock.now());
    const parser: DeliveryWebhookParser = { providerId: w.courier.providerId, verify: () => true, parse: () => ({ eventId: 'e9', merchantReference: s.merchantReference, providerReference: null, state: 'in_transit', stateAt: '2026-10-20T07:30:00Z', trackingUrl: null, courierName: null, proof: [], minimal: {} }) };
    w.repo.failNextTransitions = 1;
    expect(await receiveDeliveryWebhook({ rawBody: '{}', headers: {}, parser, deps: { store: inbox, useCases: w.deps } })).toEqual({ status: 200, outcome: 'failed' });
    expect(inbox.rows[0].status).toBe('failed');
    expect((await drainDeliveryInbox({ store: inbox, useCases: w.deps })).claimed).toBe(0); // not due yet
    w.clock.advanceMinutes(2);
    expect(await drainDeliveryInbox({ store: inbox, useCases: w.deps })).toEqual({ claimed: 1, outcomes: { applied: 1 } });
    expect(await drainDeliveryInbox({ store: inbox, useCases: w.deps })).toEqual({ claimed: 0, outcomes: {} });
    expect(w.repo.shipments.get(s.id)?.status).toBe('in_transit');
  });

  it('D13 - an out-of-order webhook cannot regress shipment state', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    expect(await recordProviderEvent(ev(w, s, 'delivered', '2026-10-20T08:00:00Z'), w.deps)).toBe('applied');
    expect(await recordProviderEvent(ev(w, s, 'in_transit', '2026-10-20T07:30:00Z'), w.deps)).toBe('stale');
    expect(await recordProviderEvent(ev(w, s, 'courier_assigned', '2026-10-20T07:00:00Z'), w.deps)).toBe('stale');
    expect(w.repo.shipments.get(s.id)).toMatchObject({ status: 'delivered', lastProviderStateAt: '2026-10-20T08:00:00Z' });
    // A provider "cancelled" after collection is refused and flagged to staff.
    expect(await recordProviderEvent(ev(w, s, 'cancelled', '2026-10-20T09:00:00Z'), w.deps)).toBe('not_allowed');
    expect(w.repo.shipments.get(s.id)?.status).toBe('delivered');
    expect(w.repo.refunds.size).toBe(0);
    expect(w.repo.noticesFor('staff').length).toBeGreaterThan(0);
  });

  it('a courier "delivered" alone does not certify receipt', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    await recordProviderEvent(ev(w, s, 'delivered', '2026-10-20T08:00:00Z', { proof: [{ kind: 'photo', ref: 'pod-1' }] }), w.deps);
    const chains = chainsByItem(w.repo.custody);
    expect(outboundReceipt(chains.get('bk-1:cam-1') ?? [])).toBe('awaiting_renter');
    expect([...w.repo.journals.keys()].some((k) => k.startsWith('delivery:'))).toBe(false);
    expect(w.repo.noticesFor(RENTER)).toContain('delivery_delivered:sms');
    expect(w.repo.proofs.map((p) => p.ref)).toContain('pod-1');
  });
});

describe('custody and evidence', () => {
  it('D14 - delivery evidence is linked to the correct booking and shipment', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    expect(await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-9', rentalId: 'cam-1', evidence: photo }, w.deps)).toMatchObject({ ok: false, code: 'item_not_on_shipment' });
    expect(await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-2', rentalId: 'lens-1', evidence: photo }, w.deps)).toMatchObject({ ok: false, code: 'not_owner' });
    expect(await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: [] }, w.deps)).toMatchObject({ ok: false, code: 'evidence_required' });
    const r = await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo, accessories: [{ name: 'battery', present: true }], serialConfirmed: true }, w.deps);
    expect(r).toMatchObject({ ok: true, duplicate: false });
    const e = w.repo.custody.find((c) => c.kind === 'handed_to_courier');
    expect(e).toMatchObject({ shipmentId: s.id, bookingGroupId: GROUP, bookingId: 'bk-1', rentalId: 'cam-1', serialNumber: 'SN-cam-1', serialConfirmed: true, actor: { kind: 'owner', id: OWNER_A } });
    expect(w.repo.proofs.find((p) => p.ref === 'photos/1.jpg')).toMatchObject({ shipmentId: s.id, bookingId: 'bk-1' });
    // The same confirmation again is stored once.
    expect(await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo }, w.deps)).toMatchObject({ ok: true, duplicate: true });
    expect(w.repo.custody.filter((c) => c.kind === 'handed_to_courier')).toHaveLength(1);
  });

  it('D15 - the wrong recipient cannot confirm handover', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    await recordProviderEvent(ev(w, s, 'delivered', '2026-10-20T08:00:00Z'), w.deps);
    const accept = (caller: Parameters<typeof confirmHandover>[0]['caller']) => confirmHandover({ caller, shipmentId: s.id, bookingId: 'bk-1', rentalId: 'cam-1', outcome: 'accepted', evidence: [] }, w.deps);
    expect(await accept({ kind: 'renter', userId: OTHER_USER })).toMatchObject({ ok: false, code: 'wrong_recipient' });
    expect(await accept(ownerA)).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(await accept(staff)).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(await accept({ kind: 'agent', userId: RENTER, approval: null })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await accept({ kind: 'system' })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await accept(renter)).toMatchObject({ ok: true });
    expect(w.repo.custody.filter((c) => c.kind === 'renter_accepted').map((c) => c.actor)).toEqual([{ kind: 'renter', id: RENTER }]);
  });

  it('D28 - multiple items keep separate custody records', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    await recordProviderEvent(ev(w, s, 'delivered', '2026-10-20T08:00:00Z'), w.deps);
    expect(await confirmHandover({ caller: renter, shipmentId: s.id, bookingId: 'bk-1', rentalId: 'cam-1', outcome: 'accepted', evidence: [], serialConfirmed: true }, w.deps)).toMatchObject({ ok: true });
    // Not all items accepted yet: the outbound fee is not earned.
    expect(w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(false);
    const ex = await confirmHandover({ caller: renter, shipmentId: s.id, bookingId: 'bk-2', rentalId: 'lens-1', outcome: 'exception', evidence: photo, discrepancies: ['lens cap missing'], exceptionKind: 'damaged' }, w.deps);
    expect(ex).toMatchObject({ ok: true });
    const chains = chainsByItem(w.repo.custody);
    expect(outboundReceipt(chains.get('bk-1:cam-1') ?? [])).toBe('accepted');
    expect(outboundReceipt(chains.get('bk-2:lens-1') ?? [])).toBe('exception');
    const incidents = [...w.repo.incidents.values()];
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ bookingIds: ['bk-2'], kind: 'damaged', liability: 'undetermined', status: 'open' });
    expect(w.repo.shipments.get(s.id)?.status).toBe('incident_under_review');
    expect(w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(false);
    // The camera's line can settle; the lens line cannot while the incident is open.
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).allowed).toBe(true);
    expect(await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-2' }, w.deps)).toMatchObject({ allowed: false, reasons: ['open_delivery_incident'] });
  });
});

describe('incidents', () => {
  it('D16 - a lost shipment creates an incident (from the provider or from staff), with no accusation', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    await recordProviderEvent(ev(w, s, 'collected', '2026-10-20T07:10:00Z'), w.deps);
    expect(await recordProviderEvent(ev(w, s, 'lost', '2026-10-20T09:00:00Z'), w.deps)).toBe('applied');
    expect(w.repo.shipments.get(s.id)?.status).toBe('lost');
    const [inc] = [...w.repo.incidents.values()];
    expect(inc).toMatchObject({ kind: 'lost', status: 'open', providerCaused: true, liability: 'undetermined', reportedBy: { kind: 'provider' } });
    expect(w.repo.noticesFor(RENTER)).toContain('delivery_incident:in_app');
    // Staff can also report it; the replay of the same report opens nothing new.
    const w2 = courierWorld();
    const s2 = await dispatched(w2);
    await recordProviderEvent(ev(w2, s2, 'in_transit', '2026-10-20T07:30:00Z'), w2.deps);
    const r = await reportIncident({ caller: staff, shipmentId: s2.id, kind: 'lost', description: 'Driver cannot locate the parcel' }, w2.deps);
    expect(r).toMatchObject({ ok: true, duplicate: false });
    expect(w2.repo.shipments.get(s2.id)?.status).toBe('incident_under_review');
    expect(await reportIncident({ caller: { kind: 'renter', userId: OTHER_USER }, shipmentId: s2.id, kind: 'lost', description: 'not mine' }, w2.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    // Nothing touches the deposit or accuses the renter.
    expect([...w2.repo.journals.values()].some((j) => j.lines.some((l) => l.account === 'damage_income'))).toBe(false);
  });

  it('D19 - a provider-caused delay is not turned into an automatic late fee', async () => {
    const w = courierWorld();
    await dispatched(w, 'outbound');
    const ret = await dispatched(w, 'return');
    // The return driver did not arrive.
    const r = await reportIncident({ caller: staff, shipmentId: ret.id, kind: 'driver_no_show', description: 'Return driver no-show', providerCaused: true }, w.deps);
    expect(r.ok).toBe(true);
    let check = await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps);
    expect(check.lateFeeAutoCharge).toBe(false);
    // Even after it is resolved, a provider-caused delay still protects the renter.
    await resolveIncident({ caller: staff, incidentId: (r as { incidentId: string }).incidentId, resolution: 'rebooked next day', providerCaused: true, liability: 'provider' }, w.deps);
    check = await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps);
    expect(check.lateFeeAutoCharge).toBe(false);
    // A failed attempt is unattributed until a person decides: also no automatic fee.
    const failed = newIncident({ id: 'i', shipmentId: ret.id, bookingGroupId: GROUP, bookingIds: [], leg: 'return', kind: 'failed_attempt', reportedBy: { kind: 'provider', id: null }, description: 'x', providerCaused: null, now: new Date() });
    expect(lateFeeAutoChargeAllowed([failed])).toEqual({ allowed: false, reason: 'delay_not_yet_attributed' });
    expect(lateFeeAutoChargeAllowed([{ ...failed, providerCaused: false }])).toEqual({ allowed: true, reason: null });
    // A delay on the OUTBOUND leg says nothing about the return.
    expect(lateFeeAutoChargeAllowed([{ ...failed, leg: 'outbound' }]).allowed).toBe(true);
  });

  it('D29 - shipment incidents block premature rental settlement', async () => {
    const w = courierWorld();
    const s = await dispatched(w);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).allowed).toBe(true);
    const r = await reportIncident({ caller: renter, shipmentId: s.id, kind: 'delayed', description: 'Delivery is two hours late' }, w.deps);
    expect(await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).toMatchObject({ allowed: false, reasons: ['open_delivery_incident'] });
    // Only staff resolve, with a reason.
    expect(await resolveIncident({ caller: renter, incidentId: (r as { incidentId: string }).incidentId, resolution: 'fine now', providerCaused: null, liability: 'none' }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await resolveIncident({ caller: staff, incidentId: (r as { incidentId: string }).incidentId, resolution: '', providerCaused: null, liability: 'none' }, w.deps)).toMatchObject({ ok: false, code: 'reason_required' });
    expect(await resolveIncident({ caller: staff, incidentId: (r as { incidentId: string }).incidentId, resolution: 'delivered late, no loss', providerCaused: true, liability: 'provider' }, w.deps)).toEqual({ ok: true });
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).allowed).toBe(true);
  });
});

describe('returns', () => {
  it('D17 - courier collection alone does not release the deposit', async () => {
    const w = courierWorld();
    const ret = await dispatched(w, 'return');
    await confirmCollection({ caller: renter, shipmentId: ret.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo }, w.deps);
    expect(await recordProviderEvent(ev(w, ret, 'collected', '2026-10-22T15:00:00Z'), w.deps)).toBe('applied');
    expect(await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).toMatchObject({ allowed: false, reasons: ['awaiting_inspection'] });
    await recordProviderEvent(ev(w, ret, 'delivered', '2026-10-22T16:00:00Z'), w.deps);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).allowed).toBe(false);
    expect(await confirmHandover({ caller: ownerA, shipmentId: ret.id, bookingId: 'bk-1', rentalId: 'cam-1', outcome: 'received', evidence: photo }, w.deps)).toMatchObject({ ok: true });
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).allowed).toBe(false);
    expect(await recordReturnInspection({ caller: ownerA, shipmentId: ret.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo, condition: 'clean' }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await recordReturnInspection({ caller: staff, shipmentId: ret.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo, condition: 'clean' }, w.deps)).toMatchObject({ ok: true });
    expect(await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).toMatchObject({ allowed: true, reasons: [] });
    // The other item on the leg is still out: its line cannot settle.
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-2' }, w.deps)).allowed).toBe(false);
    // The customer was never told the deposit is released on collection.
    expect(w.repo.noticesFor(RENTER)).toContain('delivery_return_collected:in_app');
  });

  it('D18 - the return shipment is tracked independently of the outbound one', async () => {
    const w = courierWorld();
    const out = await dispatched(w, 'outbound');
    const ret = await dispatched(w, 'return');
    expect(ret.id).not.toBe(out.id);
    expect(out.merchantReference).toMatch(/_o1$/);
    expect(ret.merchantReference).toMatch(/_r1$/);
    expect(w.courier.jobs.size).toBe(2);
    await recordProviderEvent(ev(w, ret, 'collected', '2026-10-22T15:00:00Z'), w.deps);
    expect(w.repo.shipments.get(out.id)?.status).toBe('scheduled');
    expect(w.repo.shipments.get(ret.id)?.status).toBe('collected');
    expect([...w.repo.journals.keys()].filter((k) => k.startsWith('courier-cost:')).sort()).toEqual([`courier-cost:${out.id}:dispatch`, `courier-cost:${ret.id}:dispatch`].sort());
  });
});
