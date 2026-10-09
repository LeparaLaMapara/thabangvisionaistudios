/**
 * Finding 14: the daily pipeline runs the delivery steps AFTER the money
 * steps (missed payments, holds, refunds, payouts) and gives them a time
 * budget; whatever does not fit waits for the next pass. The outbox always
 * runs last.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ order: [] as string[] }));
const rec = (name: string) => async () => {
  calls.order.push(name);
  return { ok: true };
};

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/payments', () => ({ payments: { isConfigured: () => true } }));
vi.mock('@/lib/rental/inbox', () => ({ drainInbox: rec('inbox') }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: rec('outbox') }));
vi.mock('@/lib/rental/workers', () => ({
  expireHolds: rec('holds'),
  recoverMissedPayments: rec('missed_payments'),
  reviewScheduledPayouts: rec('payout_review'),
  runOverdueLadder: rec('overdue'),
  runPayouts: rec('payouts'),
  runRefunds: rec('refunds'),
  runReminders: rec('reminders'),
}));
vi.mock('@/lib/delivery/server', () => ({ deliveryDeps: async () => ({}) }));
vi.mock('@/lib/delivery/repos', () => ({ SupabaseDeliveryInbox: function SupabaseDeliveryInbox() {} }));
vi.mock('@/lib/delivery/inbox', () => ({ drainDeliveryInbox: rec('delivery_inbox') }));
vi.mock('@/lib/delivery/jobs', () => ({
  SupabaseDeliveryJobQueries: function SupabaseDeliveryJobQueries() {},
  reconcileUncertainDispatches: rec('delivery_reconcile'),
  pollTrackedShipments: rec('delivery_poll'),
  deemDeliveryAcceptances: rec('delivery_acceptance'),
  remindReturnPickups: rec('delivery_return_reminders'),
}));
vi.mock('@/lib/rental/delivery-settlement', () => ({ sweepCancelledOrderDelivery: rec('delivery_cancelled_orders') }));

const { runRentalPipeline } = await import('@/lib/rental/pipeline');
const { DELIVERY_OPS } = await import('@/lib/constants');

const MONEY = ['missed_payments', 'holds', 'refunds', 'payout_review', 'payouts'];
const DELIVERY = ['delivery_inbox', 'delivery_reconcile', 'delivery_poll', 'delivery_acceptance', 'delivery_return_reminders', 'delivery_cancelled_orders'];

beforeEach(() => {
  calls.order = [];
});

describe('pipeline order and the delivery time budget', () => {
  it('money steps first, then delivery (including deemed acceptance), then the outbox', async () => {
    const r = await runRentalPipeline();
    expect(r.ok).toBe(true);
    const o = calls.order;
    const lastMoney = Math.max(...MONEY.map((m) => o.indexOf(m)));
    for (const d of DELIVERY) {
      expect(o.indexOf(d)).toBeGreaterThan(lastMoney);
      expect(o.indexOf(d)).toBeLessThan(o.indexOf('outbox'));
    }
  });

  it('once the delivery budget is spent, the remaining delivery steps are deferred; the outbox still runs', async () => {
    // The budget is used up by the first delivery step (a slow provider).
    const r = await runRentalPipeline({ now: () => (calls.order.includes('delivery_inbox') ? DELIVERY_OPS.pipelineStepsBudgetMs + 1 : 0) });
    expect(calls.order).toContain('delivery_inbox');
    for (const d of DELIVERY.slice(1)) {
      expect(calls.order).not.toContain(d);
      expect(r.steps[d]).toMatchObject({ deferred: expect.any(String) });
    }
    expect(calls.order.at(-1)).toBe('outbox');
    expect(r.ok).toBe(true);
  });
});
