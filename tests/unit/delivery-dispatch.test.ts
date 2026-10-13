/**
 * Phase 4 delivery: quote → prepare → pay → commit, with money and
 * idempotency (spec §4.7–4.8, §4.15). In-memory fakes; the fake courier keeps
 * jobs by our merchant reference, so "jobs at the provider" is observable.
 */
import { describe, expect, it, vi } from 'vitest';

// These tests check the money MECHANICS with the courier's price alone. The
// R20 platform fee per leg (D-38, 2026-10-13) is covered in
// delivery-pricing.test.ts.
vi.mock('@/lib/constants', async (orig) => {
  const m = await orig<typeof import('@/lib/constants')>();
  return { ...m, DELIVERY_POLICY: { ...m.DELIVERY_POLICY, platformFeeCents: 0 } };
});
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { balances } from '@/lib/core/rental/ledger';
import {
  cancelDelivery,
  commitDelivery,
  deliveryFeeRefundKey,
  markDeliveryQuotesPaid,
  prepareDelivery,
  priceDeliveryForCheckout,
  quoteDelivery,
  reconcileDelivery,
  scheduleReturnPickup,
} from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, OTHER_USER, RENTER, RENTER_HOME, STAFF, world, type World } from './helpers/delivery-fakes';

const COURIER_POLICY = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
const WINDOW = { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' };
const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const system = { kind: 'system' as const };

function courierWorld(): World {
  const w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
  w.deps.policy = COURIER_POLICY;
  return w;
}

async function quoteLeg(w: World, leg: 'outbound' | 'return' = 'outbound') {
  const r = await quoteDelivery(
    { caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg, originAddressId: leg === 'outbound' ? OFFICE : RENTER_HOME, destinationAddressId: leg === 'outbound' ? RENTER_HOME : OFFICE, lines: LINES_FOR_QUOTE, window: WINDOW },
    w.deps,
  );
  if (!r.ok) throw new Error(`quote failed: ${r.code}`);
  return r.quotes[0];
}

/** Quote, prepare, record the verified payment. Returns the paid shipment. */
async function paidShipment(w: World, leg: 'outbound' | 'return' = 'outbound') {
  const q = await quoteLeg(w, leg);
  const p = await prepareDelivery({ caller: renter, quoteId: q.id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(`prepare failed: ${p.code}`);
  const paid = await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.id], paidDeliveryCents: q.customerFeeCents }, w.deps);
  expect(paid).toEqual({ ok: true, marked: 1 });
  return { quote: q, shipment: p.shipment };
}

describe('quotes at checkout', () => {
  it('D07 - an expired quote cannot silently be charged or prepared', async () => {
    const w = courierWorld();
    const q = await quoteLeg(w);
    w.clock.advanceMinutes(31);
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: [q.id] }, w.deps)).toMatchObject({ ok: false, code: 'quote_expired' });
    expect(await prepareDelivery({ caller: renter, quoteId: q.id, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'quote_expired' });
    // A fresh quote at a new price is a new number the customer must approve.
    w.courier.costCents = 13_000;
    const fresh = await quoteLeg(w);
    expect(fresh.customerFeeCents).not.toBe(q.customerFeeCents);
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: [fresh.id], browserAmountCents: q.customerFeeCents }, w.deps)).toMatchObject({ ok: false, code: 'price_mismatch' });
  });

  it('D08 - the browser cannot change the delivery price', async () => {
    const w = courierWorld();
    const q = await quoteLeg(w);
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: [q.id], browserAmountCents: 1 }, w.deps)).toMatchObject({ ok: false, code: 'price_mismatch' });
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: [q.id] }, w.deps)).toEqual({ ok: true, amountCents: 12_000 });
    // Someone else's quote, or the same leg twice, is refused.
    expect(await priceDeliveryForCheckout({ renterId: OTHER_USER, quoteIds: [q.id] }, w.deps)).toMatchObject({ ok: false, code: 'wrong_renter' });
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: [q.id, (await quoteLeg(w)).id] }, w.deps)).toMatchObject({ ok: false, code: 'duplicate_leg' });
    // A payment that does not match the stored quotes marks nothing.
    const m = await markDeliveryQuotesPaid({ paymentReference: 'pay-x', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.id], paidDeliveryCents: 100 }, w.deps);
    expect(m).toMatchObject({ ok: false, code: 'amount_mismatch' });
    expect(w.repo.quotes.get(q.id)?.status).toBe('active');
  });
});

describe('dispatch (commit)', () => {
  it('D09 - a repeated dispatch command books only once', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    const [a, b] = await Promise.all([commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps), commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)]);
    const c = await commitDelivery({ caller: staff, shipmentId: shipment.id }, w.deps);
    expect([a, b].filter((r) => r.ok && r.outcome === 'dispatched')).toHaveLength(1);
    expect(c).toMatchObject({ ok: true, outcome: 'already_dispatched' });
    expect(w.courier.createCalls).toBe(1);
    expect(w.courier.jobs.size).toBe(1);
    expect([...w.repo.journals.keys()].filter((k) => k.startsWith('courier-cost:'))).toEqual([`courier-cost:${shipment.id}:dispatch`]);
    expect(w.repo.shipments.get(shipment.id)?.status).toBe('scheduled');
  });

  it('D10 - a timeout after the provider created the job does not create a second courier', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    w.courier.createScript = ['unknown_after_create'];
    const first = await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    expect(first).toMatchObject({ ok: false, code: 'dispatch_unknown' });
    expect(w.repo.shipments.get(shipment.id)?.status).toBe('booking');
    expect(w.repo.intents.get(shipment.id)?.state).toBe('unknown');
    // The provider cannot be reached: still no create.
    w.courier.findBehaviour = 'unknown';
    expect(await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'reconcile_pending' });
    w.courier.findBehaviour = 'ok';
    const second = await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    expect(second).toMatchObject({ ok: true, outcome: 'reconciled' });
    expect(w.courier.createCalls).toBe(1);
    expect(w.courier.jobs.size).toBe(1);
    expect(w.repo.shipments.get(shipment.id)).toMatchObject({ status: 'scheduled', providerReference: 'job-1' });
  });

  it('D10 - a timeout before the job existed is retried with the SAME merchant reference', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    w.courier.createScript = ['unknown_before_create'];
    await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    const again = await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    expect(again).toMatchObject({ ok: true, outcome: 'dispatched' });
    expect(w.courier.findCalls).toBe(1);
    expect(w.courier.jobs.size).toBe(1);
    expect([...w.courier.jobs.keys()]).toEqual([shipment.merchantReference]);
  });

  it('D10 - an exception thrown by the adapter is an unknown outcome, never a failure', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    w.courier.createScript = ['throw_after_create'];
    expect(await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'dispatch_unknown' });
    expect(w.repo.refunds.size).toBe(0);
    expect(await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)).toMatchObject({ ok: true, outcome: 'reconciled' });
    expect(w.courier.jobs.size).toBe(1);
  });

  it('D10 - a provider update that arrives before the timed-out create is reconciled keeps one job and one cost', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    w.courier.createScript = ['unknown_after_create'];
    await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    // The courier's webhook (by our merchant reference) arrives first.
    const { recordProviderEvent } = await import('@/lib/core/delivery/use-cases');
    expect(await recordProviderEvent({ providerId: 'fake_courier', verified: true, dedupeKey: 'wh-1', merchantReference: shipment.merchantReference, providerReference: 'job-1', state: 'courier_assigned', stateAt: '2026-10-20T06:40:00Z', source: 'provider_webhook' }, w.deps)).toBe('applied');
    expect(await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)).toMatchObject({ ok: true, outcome: 'reconciled' });
    expect(w.repo.shipments.get(shipment.id)).toMatchObject({ status: 'courier_assigned', providerReference: 'job-1', accruedCostCents: 12_000 });
    expect(w.courier.createCalls).toBe(1);
    expect([...w.repo.journals.keys()].filter((k) => k.startsWith('courier-cost:'))).toHaveLength(1);
  });

  it('D09 - a cancel during an in-flight create waits; a cancelled leg can never be dispatched later', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    w.repo.intents.get(shipment.id)!.state = 'claimed';
    w.repo.intents.get(shipment.id)!.claimedAt = w.clock.now().toISOString();
    expect(await cancelDelivery({ caller: renter, shipmentId: shipment.id, reason: 'x' }, w.deps)).toMatchObject({ ok: false, code: 'reconcile_pending' });
    // After the claim goes stale and the provider has no job, the cancel closes the intent for good.
    w.clock.advanceMinutes(11);
    expect(await cancelDelivery({ caller: renter, shipmentId: shipment.id, reason: 'x' }, w.deps)).toMatchObject({ ok: true });
    expect(w.repo.intents.get(shipment.id)?.state).toBe('rejected');
    expect(await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'shipment_closed' });
    expect(w.courier.createCalls).toBe(0);
  });

  it('nothing is dispatched before payment is verified and the booking is confirmed', async () => {
    const w = courierWorld();
    const q = await quoteLeg(w);
    const p = await prepareDelivery({ caller: renter, quoteId: q.id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    expect(await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'fee_not_paid' });
    await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.id], paidDeliveryCents: q.customerFeeCents }, w.deps);
    (w.bookings.groups.get(GROUP) as { paymentVerified: boolean }).paymentVerified = false;
    expect(await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'payment_not_verified' });
    (w.bookings.groups.get(GROUP) as { paymentVerified: boolean }).paymentVerified = true;
    w.bookings.setStatus(GROUP, 'pending');
    expect(await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'booking_state' });
    expect(w.courier.createCalls).toBe(0);
  });

  it('D24 - a failed dispatch does not leave orphaned payment state', async () => {
    const w = courierWorld();
    const { shipment, quote } = await paidShipment(w);
    w.courier.createScript = ['rejected', 'rejected'];
    // The database fails exactly when the failure is being recorded.
    w.repo.failWhen = (t) => t.to === 'failed';
    await expect(commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)).rejects.toThrow('database unavailable');
    expect(w.repo.refunds.size).toBe(0);
    expect(w.repo.intents.get(shipment.id)?.state).toBe('claimed');
    // Next run after the claim goes stale: reconciles (no job), retries once, records the failure and the refund together.
    w.clock.advanceMinutes(11);
    const r = await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    expect(r).toMatchObject({ ok: false, code: 'dispatch_rejected', refundDueCents: quote.customerFeeCents });
    expect(w.repo.shipments.get(shipment.id)?.status).toBe('failed');
    expect(w.repo.intents.get(shipment.id)?.state).toBe('rejected');
    expect([...w.repo.refunds.values()]).toEqual([{ key: deliveryFeeRefundKey(shipment.id), amountCents: quote.customerFeeCents, paidReference: 'pay-ref-1', userId: RENTER }]);
    const b = balances([...w.repo.journals.values()]);
    expect(b.unearned_hire).toBe(quote.customerFeeCents); // the fee left unearned hire (debit) ...
    expect(b.refunds_payable).toBe(-quote.customerFeeCents); // ... and is owed back
    expect(b.courier_costs).toBe(0);
    expect(w.repo.noticesFor(RENTER)).toContain('delivery_fee_refund:email');
    // The hire itself is untouched: collection in person remains possible.
    expect(w.bookings.groups.get(GROUP)?.lines.every((l) => l.status === 'confirmed')).toBe(true);
    // A later commit does not refund twice.
    await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    expect(w.repo.refunds.size).toBe(1);
  });

  it('D26 - AI cannot create an unapproved paid shipment', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    const agent = { kind: 'agent' as const, userId: RENTER, approval: { verified: true, userId: RENTER, amountCents: 12_000 } };
    expect(await commitDelivery({ caller: agent, shipmentId: shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'agent_not_allowed' });
    expect(w.courier.createCalls).toBe(0);
    // A return pickup (a new charge) needs the person's verified approval for exactly that fee.
    w.bookings.setStatus(GROUP, 'active');
    const rq = await quoteLeg(w, 'return');
    expect(await scheduleReturnPickup({ caller: { ...agent, approval: null }, bookingGroupId: GROUP, quoteId: rq.id }, w.deps)).toMatchObject({ ok: false, code: 'approval_required' });
    expect(await scheduleReturnPickup({ caller: { ...agent, approval: { verified: true, userId: RENTER, amountCents: 1 } }, bookingGroupId: GROUP, quoteId: rq.id }, w.deps)).toMatchObject({ ok: false, code: 'approval_required' });
    expect(await scheduleReturnPickup({ caller: { ...agent, approval: { verified: false, userId: RENTER, amountCents: rq.customerFeeCents } }, bookingGroupId: GROUP, quoteId: rq.id }, w.deps)).toMatchObject({ ok: false, code: 'approval_required' });
    // Another person's agent session cannot act for this renter.
    expect(await scheduleReturnPickup({ caller: { kind: 'agent', userId: OTHER_USER, approval: { verified: true, userId: OTHER_USER, amountCents: rq.customerFeeCents } }, bookingGroupId: GROUP, quoteId: rq.id }, w.deps)).toMatchObject({ ok: false });
    // With approval it is prepared but NOT dispatched until the fee is paid.
    const ok = await scheduleReturnPickup({ caller: { ...agent, approval: { verified: true, userId: RENTER, amountCents: rq.customerFeeCents } }, bookingGroupId: GROUP, quoteId: rq.id }, w.deps);
    expect(ok).toMatchObject({ ok: true, created: true });
    expect(w.courier.createCalls).toBe(0);
    // Cancelling a paid delivery through the agent also needs approval.
    expect(await cancelDelivery({ caller: { ...agent, approval: null }, shipmentId: shipment.id, reason: 'changed my mind' }, w.deps)).toMatchObject({ ok: false, code: 'approval_required' });
  });
});

describe('cancellation money (D23)', () => {
  it('D23 - a renter cancelling after dispatch pays the courier fee at cost; the rest is refunded', async () => {
    const w = courierWorld();
    w.courier.cancelFeeCents = 3_000;
    const { shipment } = await paidShipment(w);
    await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    const r = await cancelDelivery({ caller: renter, shipmentId: shipment.id, reason: 'plans changed' }, w.deps);
    expect(r).toEqual({ ok: true, refundCents: 9_000, providerFeeCents: 3_000, duplicate: false });
    const b = balances([...w.repo.journals.values()]);
    expect(b.delivery_income).toBe(-3_000);
    expect(b.refunds_payable).toBe(-9_000);
    expect(b.unearned_hire).toBe(12_000);
    expect(b.courier_costs).toBe(3_000); // the job cost was reversed, only the fee remains
    expect(b.delivery_payable).toBe(-3_000);
    expect(w.repo.shipments.get(shipment.id)).toMatchObject({ status: 'cancelled', accruedCostCents: 3_000 });
    // Cancelling again changes nothing.
    expect(await cancelDelivery({ caller: renter, shipmentId: shipment.id, reason: 'again' }, w.deps)).toMatchObject({ ok: true, duplicate: true });
    expect(w.repo.refunds.size).toBe(1);
  });

  it('D23 - when we (or the provider) cancel, the customer is refunded in full and we absorb the fee', async () => {
    const w = courierWorld();
    w.courier.cancelFeeCents = 3_000;
    const { shipment } = await paidShipment(w);
    await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    const r = await cancelDelivery({ caller: staff, shipmentId: shipment.id, reason: 'no driver available', initiatedBy: 'platform' }, w.deps);
    expect(r).toMatchObject({ ok: true, refundCents: 12_000, providerFeeCents: 3_000 });
    const b = balances([...w.repo.journals.values()]);
    expect(b.delivery_income).toBe(0);
    expect(b.courier_costs).toBe(3_000);
  });

  it('D23 - cancelling before dispatch calls no provider and refunds the paid fee', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    const r = await cancelDelivery({ caller: renter, shipmentId: shipment.id, reason: 'collect instead' }, w.deps);
    expect(r).toMatchObject({ ok: true, refundCents: 12_000, providerFeeCents: 0 });
    expect(w.courier.createCalls).toBe(0);
    expect(w.repo.intents.get(shipment.id)?.state).toBe('rejected');
    expect(await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps)).toMatchObject({ ok: false });
    expect(w.courier.createCalls).toBe(0);
  });

  it('a leg already collected cannot be cancelled (it becomes an incident instead)', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    w.repo.shipments.get(shipment.id)!.status = 'collected';
    expect(await cancelDelivery({ caller: renter, shipmentId: shipment.id, reason: 'x' }, w.deps)).toMatchObject({ ok: false, code: 'too_late' });
  });
});

describe('provider fee reconciliation (D25)', () => {
  it('D25 - delivery provider fees reconcile against what was booked', async () => {
    const w = courierWorld();
    const { shipment } = await paidShipment(w);
    await commitDelivery({ caller: system, shipmentId: shipment.id }, w.deps);
    expect(await reconcileDelivery({ caller: staff, shipmentId: shipment.id, providerInvoiceRef: 'INV-1', invoicedCents: 12_000 }, w.deps)).toMatchObject({ ok: true, status: 'matched', differenceCents: 0 });
    const over = await reconcileDelivery({ caller: staff, shipmentId: shipment.id, providerInvoiceRef: 'INV-2', invoicedCents: 13_500 }, w.deps);
    expect(over).toMatchObject({ ok: true, status: 'over', differenceCents: 1_500 });
    expect(await reconcileDelivery({ caller: staff, shipmentId: shipment.id, providerInvoiceRef: 'INV-2', invoicedCents: 13_500 }, w.deps)).toMatchObject({ duplicate: true });
    let b = balances([...w.repo.journals.values()]);
    expect(b.courier_costs).toBe(13_500);
    expect(b.delivery_payable).toBe(-13_500);
    expect(w.repo.noticesFor('staff').some((k) => k.startsWith('staff_alert'))).toBe(true);
    const under = await reconcileDelivery({ caller: staff, shipmentId: shipment.id, providerInvoiceRef: 'CN-1', invoicedCents: 11_000 }, w.deps);
    expect(under).toMatchObject({ status: 'under', differenceCents: -2_500 });
    b = balances([...w.repo.journals.values()]);
    expect(b.courier_costs).toBe(11_000);
    expect(w.repo.shipments.get(shipment.id)?.providerCostCents).toBe(11_000);
    // The customer's fee is untouched by any of this.
    expect(b.delivery_income).toBe(0);
    expect(await reconcileDelivery({ caller: renter, shipmentId: shipment.id, providerInvoiceRef: 'X', invoicedCents: 1 }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await reconcileDelivery({ caller: staff, shipmentId: shipment.id, providerInvoiceRef: 'X', invoicedCents: 1.5 }, w.deps)).toMatchObject({ ok: false, code: 'invalid_amount' });
  });

  it('our own fleet has no provider invoice', async () => {
    const w = world({ providers: 'manual' });
    const { shipment } = await paidShipment(w);
    expect(await reconcileDelivery({ caller: staff, shipmentId: shipment.id, providerInvoiceRef: 'X', invoicedCents: 1 }, w.deps)).toMatchObject({ ok: false, code: 'not_applicable' });
  });
});
