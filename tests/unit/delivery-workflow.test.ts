/**
 * Phase 4 delivery end to end (D30), access to delivery data at the use-case
 * level (D21, D22; the database side is in 076-delivery.test.sql), the
 * leg-keyed ledger, the manual adapter and the provider registry.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERY_POLICY } from '@/lib/constants';
import { DEFAULT_DELIVERY_POLICY, providerRiskGate } from '@/lib/core/delivery/policy';
import * as L from '@/lib/core/rental/ledger';
import {
  advanceManualDelivery,
  checkDeliveryEligibility,
  checkRentalSettlement,
  commitDelivery,
  confirmCollection,
  confirmHandover,
  getDeliveryStatus,
  markDeliveryQuotesPaid,
  prepareDelivery,
  quoteDelivery,
  recordProviderEvent,
  recordReturnInspection,
  scheduleReturnPickup,
} from '@/lib/core/delivery/use-cases';
import { InMemoryManualTaskStore, OWN_FLEET_CAPABILITIES, createManualDeliveryAdapter } from '@/lib/delivery/manual';
import { buildDeliveryRegistry, policyInsurance } from '@/lib/delivery/ports';
import { quoteDelivery as ownVehicleRands } from '@/lib/delivery/quote';
import { GROUP, LINES_FOR_QUOTE, OFFICE, OTHER_USER, OWNER_A, OWNER_B, RENTER, RENTER_HOME, STAFF, world } from './helpers/delivery-fakes';

const COURIER_POLICY = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const system = { kind: 'system' as const };
const photo = (n: string) => [{ kind: 'photo' as const, ref: `photos/${n}.jpg` }];

describe('D30 - entire outbound-and-return workflow', () => {
  it('D30 - courier out, rental, own-fleet return, inspection, settlement, ledger', async () => {
    const w = world({ courierEnabled: true, providers: 'both', cover: { fake_courier: 2_000_000 } });
    w.deps.policy = COURIER_POLICY;

    // 1. Checkout: quote both legs (server prices only), pick courier out and our own fleet back.
    const outQ = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' } }, w.deps);
    const retQ = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: { start: '2026-10-22T15:00:00Z', end: '2026-10-22T17:00:00Z' } }, w.deps);
    if (!outQ.ok || !retQ.ok) throw new Error('quote failed');
    expect(outQ.quotes.map((q) => q.providerId)).toEqual(['fake_courier', 'manual']); // cheaper for the renter first (2026-10-13)
    const out = outQ.quotes.find((q) => q.providerId === 'fake_courier')!;
    const back = retQ.quotes.find((q) => q.providerId === 'manual')!;
    const prep = await prepareDelivery({ caller: renter, quoteId: out.id, bookingGroupId: GROUP }, w.deps);
    if (!prep.ok) throw new Error(prep.code);
    const deliveryCents = out.customerFeeCents + back.customerFeeCents;
    const payment = L.paymentCaptured({ bookingGroupId: GROUP, providerReference: 'pay-ref-1', hireCents: 450_000, depositCents: 250_000, deliveryFeeCents: deliveryCents });
    await w.repo.post([payment], []);
    expect(await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [out.id, back.id], paidDeliveryCents: deliveryCents }, w.deps)).toEqual({ ok: true, marked: 2 });

    // 2. Dispatch after verified payment; owners hand their items to the courier.
    expect(await commitDelivery({ caller: system, shipmentId: prep.shipment.id }, w.deps)).toMatchObject({ ok: true, outcome: 'dispatched' });
    const sOut = prep.shipment;
    expect(await confirmCollection({ caller: { kind: 'owner', userId: OWNER_A }, shipmentId: sOut.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo('a1'), serialConfirmed: true }, w.deps)).toMatchObject({ ok: true });
    expect(await confirmCollection({ caller: { kind: 'owner', userId: OWNER_B }, shipmentId: sOut.id, bookingId: 'bk-2', rentalId: 'lens-1', evidence: photo('b1'), serialConfirmed: true }, w.deps)).toMatchObject({ ok: true });
    const evt = (state: Parameters<typeof recordProviderEvent>[0]['state'], at: string) =>
      recordProviderEvent({ providerId: 'fake_courier', verified: true, dedupeKey: `wh:${state}`, merchantReference: sOut.merchantReference, providerReference: null, state, stateAt: at, source: 'provider_webhook' }, w.deps);
    for (const [state, at] of [['courier_assigned', '06:40'], ['courier_at_pickup', '07:00'], ['collected', '07:05'], ['in_transit', '07:10'], ['courier_at_dropoff', '07:50'], ['delivered', '07:55']] as const) {
      expect(await evt(state, `2026-10-20T${at}:00Z`)).toBe('applied');
    }
    // The courier's "delivered" earns nothing; the renter's acceptance of every item does.
    expect(w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(false);
    await confirmHandover({ caller: renter, shipmentId: sOut.id, bookingId: 'bk-1', rentalId: 'cam-1', outcome: 'accepted', evidence: [], serialConfirmed: true }, w.deps);
    await confirmHandover({ caller: renter, shipmentId: sOut.id, bookingId: 'bk-2', rentalId: 'lens-1', outcome: 'accepted', evidence: [], serialConfirmed: true }, w.deps);
    expect(w.repo.journals.get(`delivery:${GROUP}:outbound`)?.lines).toEqual([
      { account: 'unearned_hire', debitCents: out.customerFeeCents, creditCents: 0 },
      { account: 'delivery_income', debitCents: 0, creditCents: out.customerFeeCents },
    ]);
    expect(w.repo.shipments.get(sOut.id)).toMatchObject({ status: 'delivered', acceptedAt: expect.any(String) });

    // 3. Rental period: the hire becomes active through the existing handover flow (date-based period).
    w.bookings.setStatus(GROUP, 'active');

    // 4. Return pickup by our own vehicle: a separate leg, prepaid at checkout, dispatched at once.
    const ret = await scheduleReturnPickup({ caller: renter, bookingGroupId: GROUP, quoteId: back.id }, w.deps);
    expect(ret).toMatchObject({ ok: true, outcome: 'dispatched' });
    const sRet = (await w.repo.listShipments(GROUP)).find((s) => s.leg === 'return')!;
    expect(w.tasks.tasks.size).toBe(1); // a staff task, no external call
    expect(await advanceManualDelivery({ caller: staff, shipmentId: sRet.id, state: 'courier_assigned' }, w.deps)).toBe('applied');
    expect(await advanceManualDelivery({ caller: renter, shipmentId: sRet.id, state: 'in_transit' }, w.deps)).toBe('not_allowed');
    for (const [bookingId, rentalId] of [['bk-1', 'cam-1'], ['bk-2', 'lens-1']] as const) {
      expect(await confirmCollection({ caller: renter, shipmentId: sRet.id, bookingId, rentalId, evidence: photo(`r-${rentalId}`) }, w.deps)).toMatchObject({ ok: true });
      expect(await confirmCollection({ caller: staff, shipmentId: sRet.id, bookingId, rentalId, evidence: photo(`s-${rentalId}`) }, w.deps)).toMatchObject({ ok: true });
    }
    expect(w.repo.shipments.get(sRet.id)?.status).toBe('collected');
    // Collected by our driver: the deposit is NOT released (D17).
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).allowed).toBe(false);
    expect(await advanceManualDelivery({ caller: staff, shipmentId: sRet.id, state: 'in_transit' }, w.deps)).toBe('applied');
    await confirmHandover({ caller: { kind: 'owner', userId: OWNER_A }, shipmentId: sRet.id, bookingId: 'bk-1', rentalId: 'cam-1', outcome: 'received', evidence: photo('a2') }, w.deps);
    await confirmHandover({ caller: staff, shipmentId: sRet.id, bookingId: 'bk-2', rentalId: 'lens-1', outcome: 'received', evidence: photo('b2') }, w.deps);
    expect(w.repo.shipments.get(sRet.id)?.status).toBe('delivered');
    expect(w.repo.journals.has(`delivery:${GROUP}:return`)).toBe(true);

    // 5. Inspection, then settlement may proceed.
    for (const [bookingId, rentalId] of [['bk-1', 'cam-1'], ['bk-2', 'lens-1']] as const) {
      expect(await recordReturnInspection({ caller: staff, shipmentId: sRet.id, bookingId, rentalId, evidence: photo(`i-${rentalId}`), condition: 'clean' }, w.deps)).toMatchObject({ ok: true });
      // returnCollectedAt (D-49): when the return pickup took the gear from the renter.
      expect(await checkRentalSettlement({ bookingGroupId: GROUP, bookingId }, w.deps)).toEqual({ allowed: true, reasons: [], lateFeeAutoCharge: true, returnCollectedAt: expect.any(String) });
    }

    // 6. Ledger: every delivery cent paid is earned, leg by leg; the courier cost is ours, owed to the provider.
    const b = L.balances([...w.repo.journals.values()]);
    expect(b.unearned_hire).toBe(-450_000); // only the hire is left (settled by the existing hire flow)
    expect(b.delivery_income).toBe(-deliveryCents);
    expect(b.courier_costs).toBe(out.quoteAmountCents);
    expect(b.delivery_payable).toBe(-out.quoteAmountCents);
    expect(b.owner_payable).toBe(0); // delivery money never reaches the owners' share
    for (const j of w.repo.journals.values()) expect(L.isBalanced(j)).toBe(true);

    // 7. Each item has its own complete chain.
    const custodyKinds = (rentalId: string) => w.repo.custody.filter((c) => c.rentalId === rentalId).map((c) => c.kind);
    expect(custodyKinds('cam-1')).toEqual(['handed_to_courier', 'collected_by_courier', 'delivered_to_renter', 'renter_accepted', 'handed_to_return_courier', 'collected_by_courier', 'received_by_owner', 'inspected']);
    expect(w.repo.noticesFor(RENTER)).toEqual(expect.arrayContaining(['delivery_booked:email', 'delivery_delivered:sms', 'delivery_returned_for_inspection:email']));
    expect(w.repo.noticesFor(OWNER_A)).toContain('delivery_courier_at_pickup:in_app');
  });
});

describe('access to delivery data (use-case level)', () => {
  it('D21 - addresses are only used by their owner; the status view never carries an address', async () => {
    const w = world();
    const r = await checkDeliveryEligibility({ renterId: OTHER_USER, leg: 'outbound', renterAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE }, w.deps);
    expect(r).toMatchObject({ ok: false, code: 'address_not_found' });
    const q = await quoteDelivery({ caller: { kind: 'renter', userId: OTHER_USER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: null } }, w.deps);
    expect(q).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('D22 - an owner sees only their own items and never the renter-side tracking link', async () => {
    const w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
    w.deps.policy = COURIER_POLICY;
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: null } }, w.deps);
    if (!q.ok) throw new Error(q.code);
    const p = await prepareDelivery({ caller: renter, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    await markDeliveryQuotesPaid({ paymentReference: 'pay', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
    await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps);
    const asB = await getDeliveryStatus({ caller: { kind: 'owner', userId: OWNER_B }, bookingGroupId: GROUP }, w.deps);
    expect(asB.ok && asB.legs[0].items.map((i) => i.rentalId)).toEqual(['lens-1']);
    expect(asB.ok && asB.legs[0].trackingUrl).toBeNull();
    const asRenter = await getDeliveryStatus({ caller: renter, bookingGroupId: GROUP }, w.deps);
    expect(asRenter.ok && asRenter.legs[0].trackingUrl).toBe('https://track.example/abc');
    expect(await getDeliveryStatus({ caller: { kind: 'owner', userId: OTHER_USER }, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await getDeliveryStatus({ caller: { kind: 'renter', userId: OTHER_USER }, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    // An owner cannot record the other owner's handover either.
    expect(await confirmCollection({ caller: { kind: 'owner', userId: OWNER_B }, shipmentId: p.shipment.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo('x') }, w.deps)).toMatchObject({ ok: false, code: 'not_owner' });
  });
});

describe('ledger: leg-keyed delivery journals', () => {
  it('outbound and return legs are separate journals; the legacy call keeps its old key', () => {
    const out = L.deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, leg: 'outbound' });
    const ret = L.deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, leg: 'return' });
    const legacy = L.deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100 });
    expect([out.idempotencyKey, ret.idempotencyKey, legacy.idempotencyKey]).toEqual(['delivery:g:outbound', 'delivery:g:return', 'delivery:g']);
    expect(L.courierCost({ shipmentId: 's', bookingGroupId: 'g', amountCents: 5, what: 'dispatch' }).lines).toEqual([
      { account: 'courier_costs', debitCents: 5, creditCents: 0 },
      { account: 'delivery_payable', debitCents: 0, creditCents: 5 },
    ]);
    expect(() => L.deliveryCancelled({ shipmentId: 's', bookingGroupId: 'g', customerFeeCents: 100, refundCents: 101 })).toThrow();
    expect(L.LEDGER_ACCOUNTS).toMatchObject({ courier_costs: 'expense', delivery_payable: 'liability', delivery_income: 'revenue' });
  });
});

describe('manual adapter (our own vehicle)', () => {
  it('quotes the existing own-vehicle formula in cents and dispatches by creating one staff task', async () => {
    const store = new InMemoryManualTaskStore();
    const port = createManualDeliveryAdapter(store, { now: () => new Date('2026-10-10T08:00:00Z') });
    const office = { lat: -26.1929, lng: 28.0305, suburb: null, city: null, postalCode: null };
    const home = { lat: -26.1076, lng: 28.0567, suburb: null, city: null, postalCode: null };
    const items = [{ rentalId: 'r', bookingId: 'b', driverLabel: 'camera equipment', replacementValueCents: 1, weightGrams: null, containsLithium: false }];
    const q = await port.quote({ from: office, to: home, window: { start: null, end: null }, items, leg: 'outbound' });
    const rands = ownVehicleRands({ destination: home, itemCount: 1 });
    expect(q.ok && 'fee' in rands && q.value.providerCostCents).toBe('fee' in rands ? Math.round(rands.fee * 100) : -1);
    const far = await port.checkServiceability({ from: office, to: { ...home, lat: -29.85, lng: 31.02 }, window: { start: null, end: null }, items });
    expect(far).toEqual({ ok: true, value: { serviceable: false, reason: 'out_of_area' } });
    const req = { merchantReference: 'tvd_x_o1', leg: 'outbound' as const, quote: q.ok ? q.value : (null as never), from: { ...office, placeId: 'o', formattedAddress: '', contactName: '', contactPhone: '', instructions: null }, to: { ...home, placeId: 'h', formattedAddress: '', contactName: '', contactPhone: '', instructions: null }, items, window: { start: null, end: null }, requirements: { noLeaveAtDoor: true, recipientPin: null, declaredValueCents: null } };
    const a = await port.createDelivery(req);
    const b = await port.createDelivery(req);
    expect(a.ok && b.ok && a.value.providerReference === b.value.providerReference).toBe(true);
    expect(store.tasks.size).toBe(1);
    expect(await port.findByMerchantReference('tvd_x_o1')).toMatchObject({ ok: true, value: { state: 'pending' } });
    expect(await port.getTracking('manual-tvd_x_o1')).toEqual({ ok: true, value: { state: 'pending', etaAt: null, location: null, trackingUrl: null } });
    expect(await port.cancelDelivery('manual-tvd_x_o1', 'x')).toEqual({ ok: true, value: { cancelled: true, feeCents: 0 } });
    expect(OWN_FLEET_CAPABILITIES).toMatchObject({ scheduled: true, reverseLogistics: true, pickupConfirmation: true, proofOfDelivery: true, onDemand: false, liveTracking: false, verifiedTransitCover: DELIVERY_POLICY.ownFleet.verifiedTransitCover });
  });
});

describe('provider registry and insurance stub', () => {
  const manualFactory = { manual: () => createManualDeliveryAdapter(new InMemoryManualTaskStore()) };

  it('defaults to our own fleet; an unsupported provider is a refuse-everything adapter that the gate excludes', async () => {
    expect(buildDeliveryRegistry({}, manualFactory).list().map((p) => p.providerId)).toEqual(['manual']);
    const reg = buildDeliveryRegistry({ DELIVERY_PROVIDERS: 'mystery, manual' }, manualFactory);
    expect(reg.list().map((p) => p.providerId)).toEqual(['mystery', 'manual']);
    const mystery = reg.get('mystery')!;
    expect(await mystery.createDelivery({} as never)).toMatchObject({ ok: false, kind: 'rejected' });
    const gate = providerRiskGate({ provider: mystery, leg: 'outbound', items: [], window: { start: '2026-10-20T07:00:00Z', end: null }, insurance: { covered: true, policyRef: 'P', maxItemValueCents: 1, reason: null }, allowSandbox: false, policy: COURIER_POLICY });
    expect(gate.eligible).toBe(false);
    expect(buildDeliveryRegistry({ DELIVERY_PROVIDERS: 'manual', DELIVERY_PROVIDER_MANUAL_ENABLED: 'false' }, manualFactory).list()).toEqual([]);
    const sandbox = buildDeliveryRegistry({ DELIVERY_PROVIDERS: 'manual', DELIVERY_PROVIDER_MANUAL_MODE: 'sandbox', DELIVERY_ALLOW_SANDBOX: 'true', VERCEL_ENV: 'production' }, manualFactory);
    expect(sandbox.get('manual')?.mode).toBe('sandbox');
    expect(sandbox.allowSandbox).toBe(false);
    expect(buildDeliveryRegistry({ DELIVERY_ALLOW_SANDBOX: 'true', VERCEL_ENV: 'preview' }, manualFactory).allowSandbox).toBe(true);
  });

  it("D04 - transit cover: the owner's policy covers Uber Direct up to the courier limit; nothing else is covered", async () => {
    const items = [{ rentalId: 'r', bookingId: 'b', driverLabel: 'x', replacementValueCents: 100, weightGrams: null, containsLithium: false }];
    expect(DELIVERY_POLICY.insurance.verifiedPolicyRef).toBe('owner-policy-2026-10-13');
    expect(DELIVERY_POLICY.insurance.maxItemValueCents).toBe(DELIVERY_POLICY.automatedDeliveryMaxItemValueCents);
    const a7iii = [{ ...items[0], replacementValueCents: 3_500_000 }];
    expect(await policyInsurance().coverFor({ providerId: 'uber_direct', items: a7iii, leg: 'outbound' })).toMatchObject({ covered: true, policyRef: 'owner-policy-2026-10-13' });
    expect(await policyInsurance().coverFor({ providerId: 'uber_direct', items: [{ ...items[0], replacementValueCents: 3_500_001 }], leg: 'outbound' })).toMatchObject({ covered: false, reason: 'item_above_cover_limit' });
    expect(await policyInsurance().coverFor({ providerId: 'wumdrop', items, leg: 'outbound' })).toMatchObject({ covered: false, reason: 'provider_not_covered' });
    expect(await policyInsurance({ verifiedPolicyRef: null, coveredProviders: ['uber_direct'], maxItemValueCents: 3_500_000 }).coverFor({ providerId: 'uber_direct', items, leg: 'outbound' })).toMatchObject({ covered: false, reason: 'no_verified_policy' });
    const p = policyInsurance({ verifiedPolicyRef: 'POL-9', coveredProviders: ['c'], maxItemValueCents: 50 });
    expect(await p.coverFor({ providerId: 'c', items, leg: 'outbound' })).toMatchObject({ covered: false, reason: 'item_above_cover_limit' });
    expect(await p.coverFor({ providerId: 'd', items, leg: 'outbound' })).toMatchObject({ covered: false, reason: 'provider_not_covered' });
    expect(await policyInsurance({ verifiedPolicyRef: 'POL-9', coveredProviders: ['c'], maxItemValueCents: 500 }).coverFor({ providerId: 'c', items, leg: 'return' })).toMatchObject({ covered: true, policyRef: 'POL-9' });
  });
});
