/**
 * After a VERIFIED rental payment: mark the paid quotes, prepare and commit
 * each delivery leg as the system (spec §4.8). Exactly once, however often
 * the webhook is replayed; never before the payment is verified; a failure is
 * recorded for ops and never breaks the payment confirmation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDeliveryAfterPayment } from '@/lib/delivery/after-payment';
import { quoteCartDelivery } from '@/lib/delivery/checkout';
import { cleanRenter, GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME } from './helpers/delivery-fakes';
import { checkoutWorld, type CheckoutWorld } from './helpers/delivery-checkout-fakes';

const WINDOW_OUT = { start: '2026-10-20T06:00:00.000Z', end: '2026-10-20T10:00:00.000Z' };
const WINDOW_BACK = { start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T15:00:00.000Z' };

let w: CheckoutWorld;

/** Quotes taken at checkout and tied to the order (as the checkout route does). */
async function orderWithDelivery(legs: ('outbound' | 'return')[] = ['outbound']) {
  const r = await quoteCartDelivery(
    { caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: LINES_FOR_QUOTE, legs: legs.map((leg) => ({ leg, window: leg === 'outbound' ? WINDOW_OUT : WINDOW_BACK })) },
    w.deps,
  );
  if (!r.ok) throw new Error(r.code);
  for (const q of r.quotes) expect(await w.links.linkToGroup(q.id, GROUP)).toBe(true);
  return { quotes: r.quotes, totalCents: r.quotes.reduce((s, q) => s + q.customerFeeCents, 0) };
}

const run = (paidDeliveryCents: number | null) => dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents }, { delivery: w.deps, links: w.links });
const staffAlerts = (): string[] => [...w.repo.outbox.values()].filter((n) => n.userId === 'staff').map((n) => String((n.data as { what?: string } | undefined)?.what));

describe('after a verified payment', () => {
  beforeEach(() => {
    w = checkoutWorld();
  });

  it('books each paid leg once: replays and recovery runs change nothing', async () => {
    const { quotes, totalCents } = await orderWithDelivery(['outbound', 'return']);
    const first = await run(totalCents);
    expect(first).toEqual({ outcome: 'done', legs: [{ leg: 'outbound', result: 'dispatched' }, { leg: 'return', result: 'dispatched' }] });
    for (let i = 0; i < 3; i++) {
      expect(await run(totalCents)).toEqual({ outcome: 'done', legs: [{ leg: 'outbound', result: 'already_dispatched' }, { leg: 'return', result: 'already_dispatched' }] });
    }
    // One staff task per leg (own vehicle), one shipment per leg, all paid.
    expect(w.tasks.tasks.size).toBe(2);
    const ships = await w.repo.listShipments(GROUP);
    expect(ships.map((s) => [s.leg, s.status, s.paidReference])).toEqual([
      ['outbound', 'scheduled', 'pay-ref-1'],
      ['return', 'scheduled', 'pay-ref-1'],
    ]);
    for (const q of quotes) expect(w.repo.quotes.get(q.id)?.status).toBe('consumed');
  });

  it('nothing is dispatched before the payment is verified; ops are told', async () => {
    const { totalCents } = await orderWithDelivery();
    const g = w.bookings.groups.get(GROUP);
    if (g) g.paymentVerified = false;
    expect(await run(totalCents)).toEqual({ outcome: 'payment_not_verified' });
    expect(await w.repo.listShipments(GROUP)).toHaveLength(0);
    expect(w.tasks.tasks.size).toBe(0);
    expect(staffAlerts()).toContain('delivery_needs_staff_dispatch_payment_not_verified');
  });

  it('a payment whose delivery amount differs from the stored quotes marks and dispatches nothing', async () => {
    const { quotes, totalCents } = await orderWithDelivery();
    expect(await run(totalCents - 100)).toEqual({ outcome: 'not_marked', code: 'amount_mismatch' });
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('active');
    expect(w.tasks.tasks.size).toBe(0);
    expect(staffAlerts()).toContain('delivery_amount_mismatch');
  });

  it('final eligibility is checked again: a renter now on hold is not dispatched to', async () => {
    const { totalCents } = await orderWithDelivery();
    w.trust.facts.set(RENTER, { ...cleanRenter, suspended: true });
    const r = await run(totalCents);
    expect(r).toMatchObject({ outcome: 'done', legs: [{ leg: 'outbound', result: 'prepare_not_eligible' }] });
    expect(w.tasks.tasks.size).toBe(0);
    expect(staffAlerts()).toContain('delivery_prepare_failed_not_eligible');
  });

  it('an order without delivery does nothing', async () => {
    expect(await run(0)).toEqual({ outcome: 'no_delivery' });
  });

  it('a failure inside never throws (the payment confirmation stands)', async () => {
    await orderWithDelivery();
    w.links.quotesForGroup = async () => {
      throw new Error('database down');
    };
    const r = await run(1);
    expect(r).toMatchObject({ outcome: 'error' });
    expect(staffAlerts()).toContain('delivery_after_payment_error');
  });
});

// ── The webhook inbox calls it on a confirmed payment and on replays ─────────

const hook = vi.hoisted(() => ({ calls: [] as string[][], outcome: 'confirmed' as string }));
vi.mock('@/lib/delivery/after-payment', async (orig) => ({
  ...(await orig<typeof import('@/lib/delivery/after-payment')>()),
  afterRentalPayment: async (groupId: string, source: string) => {
    hook.calls.push([groupId, source]);
    return { outcome: 'error', message: 'simulated' };
  },
}));
vi.mock('@/lib/core/rental/use-cases', async (orig) => ({
  ...(await orig<typeof import('@/lib/core/rental/use-cases')>()),
  processChargeEvent: async () => hook.outcome,
}));
vi.mock('@/lib/rental/repos', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/repos')>()),
  SupabaseRentalPayments: class {
    async getIntent() {
      return { reference: 'ref-1', checkoutGroupId: GROUP, userId: RENTER, state: 'paid', deliveryCents: 100 };
    }
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: vi.fn() }));

describe('payment inbox hook', () => {
  const event = { event: 'charge.success', dataId: 'tx-1', status: 'success', reference: 'ref-1', amountCents: 1000, currency: 'ZAR', metadataUserId: RENTER, paymentType: 'cart_checkout', transactionReference: null, transferCode: null, minimal: {} };

  it('books delivery after a confirmed payment and again (idempotently) on a replay, without changing the outcome', async () => {
    const { processPaystackEvent } = await import('@/lib/rental/inbox');
    hook.calls = [];
    hook.outcome = 'confirmed';
    expect(await processPaystackEvent(event)).toBe('confirmed');
    hook.outcome = 'duplicate';
    expect(await processPaystackEvent(event)).toBe('duplicate');
    expect(hook.calls).toEqual([
      [GROUP, 'webhook'],
      [GROUP, 'webhook'],
    ]);
  });

  it('does not run for a payment that was not confirmed (held or refunded)', async () => {
    const { processPaystackEvent } = await import('@/lib/rental/inbox');
    hook.calls = [];
    for (const o of ['mismatch_held', 'late_unavailable_refund_due', 'cancelled_refund_due', 'failure_recorded']) {
      hook.outcome = o;
      expect(await processPaystackEvent(event)).toBe(o);
    }
    expect(hook.calls).toEqual([]);
  });
});
