/**
 * runRentalPipeline runs the delivery steps (inbox drain, dispatch
 * reconciliation, polling, return reminders) before the outbox, each
 * isolated: one failing never stops the others.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ order: [] as string[], failInbox: false }));
const rec = (name: string, value: unknown = { ok: true }) => async () => {
  calls.order.push(name);
  return value;
};

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/payments', () => ({ payments: { isConfigured: () => false } }));
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
vi.mock('@/lib/delivery/server', () => ({
  deliveryDeps: async () => {
    calls.order.push('delivery_deps');
    return {};
  },
}));
vi.mock('@/lib/delivery/repos', () => ({ SupabaseDeliveryInbox: function SupabaseDeliveryInbox() {} }));
vi.mock('@/lib/delivery/inbox', () => ({
  drainDeliveryInbox: async (_deps: unknown, limit: number, maxRetries: number) => {
    calls.order.push(`delivery_inbox:${limit}:${maxRetries}`);
    if (calls.failInbox) throw new Error('inbox table unavailable');
    return { claimed: 0, outcomes: {} };
  },
}));
vi.mock('@/lib/delivery/jobs', () => ({
  SupabaseDeliveryJobQueries: function SupabaseDeliveryJobQueries() {},
  reconcileUncertainDispatches: rec('delivery_reconcile'),
  pollTrackedShipments: rec('delivery_poll'),
  deemDeliveryAcceptances: rec('delivery_acceptance'),
  remindReturnPickups: rec('delivery_return_reminders'),
}));

const { runRentalPipeline } = await import('@/lib/rental/pipeline');
const { DELIVERY_OPS } = await import('@/lib/constants');

beforeEach(() => {
  calls.order = [];
  calls.failInbox = false;
});

describe('rental pipeline: delivery steps', () => {
  it('runs every delivery step once, bounded, before the outbox; deps are built once', async () => {
    const r = await runRentalPipeline();
    expect(r.ok).toBe(true);
    const o = calls.order;
    expect(o.filter((x) => x === 'delivery_deps')).toHaveLength(1);
    expect(o).toContain(`delivery_inbox:${DELIVERY_OPS.inboxBatchSize}:${DELIVERY_OPS.inboxMaxRetries}`);
    for (const step of ['delivery_reconcile', 'delivery_poll', 'delivery_return_reminders']) expect(o.indexOf(step)).toBeLessThan(o.indexOf('outbox'));
    expect(Object.keys(r.steps)).toEqual(expect.arrayContaining(['delivery_inbox', 'delivery_reconcile', 'delivery_poll', 'delivery_return_reminders']));
  });

  it('a failing delivery step does not stop the others', async () => {
    calls.failInbox = true;
    const r = await runRentalPipeline();
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual({ delivery_inbox: 'inbox table unavailable' });
    for (const step of ['delivery_reconcile', 'delivery_poll', 'delivery_return_reminders', 'holds', 'overdue', 'outbox']) expect(calls.order).toContain(step);
  });

  it('running the pass twice is harmless (each step is idempotent on its own; the pass adds no state)', async () => {
    await runRentalPipeline();
    const once = [...calls.order];
    calls.order = [];
    await runRentalPipeline();
    expect(calls.order).toEqual(once);
  });
});
