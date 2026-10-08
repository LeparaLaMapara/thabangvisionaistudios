import { createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { drainInbox } from './inbox';
import { dispatchOutbox } from './notify';
import { expireHolds, reviewScheduledPayouts, runOverdueLadder, runPayouts, runRefunds, runReminders } from './workers';

/**
 * One pass of the rental pipeline's background work, in a safe order:
 * retry stored payment events first (they may confirm bookings), then
 * release expired holds, move refunds and payouts, run the overdue ladder
 * and reminders, and finally deliver the notifications all of that queued.
 *
 * Each step is isolated: one failing never stops the others, and every step
 * is idempotent, so running the pass twice is harmless.
 */
export async function runRentalPipeline(): Promise<{ ok: boolean; steps: Record<string, unknown>; errors: Record<string, string> }> {
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
  await step('holds', () => expireHolds(db));
  // Refunds and transfers call the payment provider; skip them while payments are off.
  if (providerReady) await step('refunds', () => runRefunds(db));
  await step('payout_review', () => reviewScheduledPayouts(db));
  if (providerReady) await step('payouts', () => runPayouts(db));
  await step('overdue', () => runOverdueLadder(db));
  await step('reminders', () => runReminders(db));
  await step('outbox', () => dispatchOutbox(200));

  return { ok: Object.keys(errors).length === 0, steps, errors };
}
