import { createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { DELIVERY_OPS } from '@/lib/constants';
import type { DeliveryDeps } from '@/lib/core/delivery/repository';
import { drainDeliveryInbox } from '@/lib/delivery/inbox';
import { SupabaseDeliveryJobQueries, deemDeliveryAcceptances, pollTrackedShipments, reconcileUncertainDispatches, remindReturnPickups } from '@/lib/delivery/jobs';
import { SupabaseDeliveryInbox } from '@/lib/delivery/repos';
import { deliveryDeps } from '@/lib/delivery/server';
import { drainInbox } from './inbox';
import { dispatchOutbox } from './notify';
import { expireHolds, recoverMissedPayments, reviewScheduledPayouts, runOverdueLadder, runPayouts, runRefunds, runReminders } from './workers';

/**
 * One pass of the rental pipeline's background work, in a safe order:
 * retry stored payment events first (they may confirm bookings), recover
 * missed payments, release expired holds, move refunds and payouts, run the
 * overdue ladder and reminders, then the delivery steps, and finally deliver
 * the notifications all of that queued.
 *
 * Each step is isolated: one failing never stops the others, and every step
 * is idempotent, so running the pass twice is harmless.
 *
 * Delivery (Phase 4): provider webhooks are the real-time source; this daily
 * pass is the safety net. It retries stored provider events, reconciles
 * dispatches whose outcome is unknown (lookup by our merchant reference,
 * never a second courier), polls courier legs whose webhooks may have been
 * missed, reminds and then deems acceptance of delivered legs (D-48), and
 * queues return-pickup reminders. These run AFTER the money steps (a slow
 * courier API must never starve payments, refunds or payouts of the cron's
 * time) and share DELIVERY_OPS.pipelineStepsBudgetMs: once it is spent the
 * remaining delivery work waits for the next pass (or "Run delivery jobs
 * now"). They still run before the outbox, so their notices go out in the
 * same pass.
 */
export async function runRentalPipeline(
  opts: { now?: () => number } = {},
): Promise<{ ok: boolean; steps: Record<string, unknown>; errors: Record<string, string> }> {
  const db = createAdminClient();
  const steps: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const providerReady = payments.isConfigured();

  const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      steps[name] = await fn();
    } catch (err) {
      errors[name] = err instanceof Error ? err.message.slice(0, 300) : 'failed';
      console.error(`[rental-pipeline] ${name} failed: ${errors[name]}`);
    }
  };

  await step('inbox', () => drainInbox(50));
  // Before releasing holds: a payment whose webhook never arrived confirms now.
  if (providerReady) await step('missed_payments', () => recoverMissedPayments(db));
  await step('holds', () => expireHolds(db));
  // Refunds and transfers call the payment provider; skip them while payments are off.
  if (providerReady) await step('refunds', () => runRefunds(db));
  await step('payout_review', () => reviewScheduledPayouts(db));
  if (providerReady) await step('payouts', () => runPayouts(db));
  await step('overdue', () => runOverdueLadder(db));
  await step('reminders', () => runReminders(db));

  // Delivery, after the money steps, within its own time budget. Deps are
  // built once, lazily: if that fails, only the delivery steps fail.
  const clock = opts.now ?? Date.now;
  const deadline = clock() + DELIVERY_OPS.pipelineStepsBudgetMs;
  let delivery: Promise<DeliveryDeps> | null = null;
  const deliveryOnce = (): Promise<DeliveryDeps> => (delivery ??= deliveryDeps());
  const jobs = new SupabaseDeliveryJobQueries(db);
  const deliveryStep = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    if (clock() > deadline) {
      steps[name] = { deferred: 'delivery time budget spent; next pass' };
      return;
    }
    await step(name, fn);
  };
  await deliveryStep('delivery_inbox', async () =>
    drainDeliveryInbox({ store: new SupabaseDeliveryInbox(db), useCases: await deliveryOnce() }, DELIVERY_OPS.inboxBatchSize, DELIVERY_OPS.inboxMaxRetries),
  );
  await deliveryStep('delivery_reconcile', async () => reconcileUncertainDispatches(await deliveryOnce(), jobs, DELIVERY_OPS.jobBatchSize, deadline));
  await deliveryStep('delivery_poll', async () => pollTrackedShipments(await deliveryOnce(), jobs, DELIVERY_OPS.jobBatchSize, deadline));
  await deliveryStep('delivery_acceptance', async () => deemDeliveryAcceptances(await deliveryOnce(), jobs, DELIVERY_OPS.jobBatchSize, deadline));
  await deliveryStep('delivery_return_reminders', async () => remindReturnPickups(await deliveryOnce(), jobs));

  await step('outbox', () => dispatchOutbox(200));

  return { ok: Object.keys(errors).length === 0, steps, errors };
}
