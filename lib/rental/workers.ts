import { createAdminClient } from '@/lib/supabase/server';
import { RENTAL_POLICY } from '@/lib/constants';
import { systemClock, type Clock, type PaymentPort, type PayoutPort } from '@/lib/core/ports';
import { processChargeEvent, submitPayout, submitRefund } from '@/lib/core/rental/use-cases';
import { checkPayoutEligibility } from '@/lib/core/rental/payouts';
import { ESCALATION_LADDER, dueEscalations, returnDueAt, type EscalationStage } from '@/lib/core/rental/overdue';
import { buildNotices, sastDate, type OutboxMessage } from '@/lib/core/rental/notifications';
import { paymentPort, payoutPort } from '@/lib/payments/ports';
import { SupabasePayouts, SupabaseRefunds, SupabaseRentalPayments, isMissingPipeline, transitionBookings } from './repos';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The rental pipeline's background work. Each step is idempotent and safe to
 * run concurrently: claims are compare-and-set, and messages and journals are
 * de-duplicated by key. app/api/cron/rental-pipeline runs them daily (the plan
 * limit), and the admin queue can run any of them on demand.
 */

async function enqueue(db: Admin, notices: OutboxMessage[]): Promise<void> {
  if (notices.length === 0) return;
  const { error } = await db.rpc('outbox_enqueue', { p_notices: notices });
  if (error && !isMissingPipeline(error)) throw new Error(`outbox_enqueue: ${error.message}`);
}

/** Release unpaid holds that ran out. Paid-but-unconfirmed rows are never touched. */
export async function expireHolds(db: Admin = createAdminClient()): Promise<number> {
  const { data, error } = await db.rpc('expire_rental_holds');
  if (error) {
    if (isMissingPipeline(error)) return 0;
    throw new Error(`expire_rental_holds: ${error.message}`);
  }
  return Number(data ?? 0);
}

/** Move refund obligations forward (submit, reconcile, escalate). */
export async function runRefunds(
  db: Admin = createAdminClient(),
  payments: PaymentPort = paymentPort,
  clock: Clock = systemClock,
  limit = 25,
): Promise<Record<string, number>> {
  const { data, error } = await db
    .from('refund_obligations')
    .select('id')
    // In-flight refunds too: if their webhook is lost, submitRefund polls the provider.
    .in('state', ['eligible', 'claimed', 'requested', 'pending', 'processing'])
    .eq('provider', payments.provider)
    .order('created_at')
    .limit(limit);
  if (error) {
    if (isMissingPipeline(error)) return {};
    throw new Error(`refund queue: ${error.message}`);
  }
  const refunds = new SupabaseRefunds(db);
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { id: string }[]) {
    const r = await submitRefund(row.id, { refunds, payments, clock });
    out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}

interface PayoutQueueRow {
  id: string;
  booking_id: string;
  owner_id: string;
  state: string;
  scheduled_at: string;
  owner_amount_cents: number;
}

/**
 * Check scheduled payouts against every condition in spec §7.8. Eligible ones
 * are approved automatically only when RENTAL_POLICY.payoutAutoApprove is on.
 * Otherwise they wait in the admin queue with an empty hold list. Ineligible
 * ones are held, with the reasons recorded.
 */
export async function reviewScheduledPayouts(db: Admin = createAdminClient(), clock: Clock = systemClock): Promise<Record<string, number>> {
  const now = clock.now();
  const { data, error } = await db
    .from('owner_payouts')
    .select('id, booking_id, owner_id, state, scheduled_at, owner_amount_cents')
    .in('state', ['scheduled', 'held'])
    .lte('scheduled_at', now.toISOString())
    .limit(100);
  if (error) {
    if (isMissingPipeline(error)) return {};
    throw new Error(`payout queue: ${error.message}`);
  }
  const payouts = new SupabasePayouts(db);
  const out: Record<string, number> = {};
  for (const p of (data ?? []) as PayoutQueueRow[]) {
    const decision = await evaluatePayout(db, p, now);
    if (!decision.eligible) {
      await payouts.transition(p.id, [p.state as 'scheduled' | 'held'], 'held', { lastError: null, holdReasons: decision.reasons }, null, []);
      out.held = (out.held ?? 0) + 1;
      continue;
    }
    if (RENTAL_POLICY.payoutAutoApprove && decision.recipientCode) {
      await payouts.transition(p.id, [p.state as 'scheduled' | 'held'], 'approved', { recipientCode: decision.recipientCode, holdReasons: [] }, null, []);
      out.approved = (out.approved ?? 0) + 1;
    } else {
      // Eligible: waits for a person. Clear any old hold reasons so the queue shows it as ready.
      if (p.state === 'held') await payouts.transition(p.id, ['held'], 'scheduled', { holdReasons: [] }, null, []);
      out.awaiting_approval = (out.awaiting_approval ?? 0) + 1;
    }
  }
  return out;
}

/** Facts for one payout, read with the service role. */
export async function evaluatePayout(
  db: Admin,
  p: { booking_id: string; owner_id: string },
  now: Date,
): Promise<{ eligible: true; recipientCode: string | null } | { eligible: false; reasons: string[] }> {
  const [{ data: booking }, { data: owner }, { data: bank }, { count: disputes }, { data: refunds }, { data: payoutRow }] = await Promise.all([
    db.from('equipment_bookings').select('status, completed_at, inspection_outcome, checkout_group_id, payfast_payment_id, payment_plan, balance_due').eq('id', p.booking_id).maybeSingle(),
    db.from('profiles').select('verification_status').eq('id', p.owner_id).maybeSingle(),
    db.from('banking_details').select('is_verified, paystack_recipient_code').eq('user_id', p.owner_id).maybeSingle(),
    db.from('disputes').select('id', { count: 'exact', head: true }).eq('equipment_booking_id', p.booking_id).in('status', ['open', 'investigating', 'escalated']),
    // Every refund that settles this booking (deposit, or a dispute's manual refund) must be done first.
    db.from('refund_obligations').select('state, reason').contains('booking_ids', [p.booking_id]),
    db.from('owner_payouts').select('state').eq('booking_id', p.booking_id).maybeSingle(),
  ]);
  const b = booking as {
    status: string; completed_at: string | null; inspection_outcome: string | null; checkout_group_id: string | null;
    payfast_payment_id: string | null; payment_plan: string | null; balance_due: number | null;
  } | null;
  const bank_ = bank as { is_verified?: boolean; paystack_recipient_code?: string | null } | null;

  let paymentConfirmed = Boolean(b?.payfast_payment_id);
  if (b?.checkout_group_id) {
    const { data: intent } = await db.from('rental_payment_intents').select('state').eq('checkout_group_id', b.checkout_group_id).maybeSingle();
    if (intent) paymentConfirmed = (intent as { state: string }).state === 'paid';
  }
  // A deposit-only order's hire was due at the counter with no recorded payment:
  // the paid intent covers only the deposit, so the hire is not confirmed.
  if (b?.payment_plan === 'deposit_only' && Number(b.balance_due ?? 0) > 0) paymentConfirmed = false;
  // Nothing to refund needs no obligation; every one that exists must be processed.
  const depositRefunds = (refunds ?? []) as { state: string }[];
  const depositSettled = depositRefunds.every((r) => r.state === 'processed');

  const result = checkPayoutEligibility(
    {
      ownerVerified: (owner as { verification_status?: string } | null)?.verification_status === 'verified',
      payoutRecipientValidated: Boolean(bank_?.is_verified && bank_?.paystack_recipient_code),
      bookingStatus: b?.status ?? 'missing',
      rentalPaymentConfirmed: paymentConfirmed,
      inspectionCompleted: Boolean(b?.inspection_outcome),
      openPayoutBlockingDisputes: disputes ?? 0,
      depositSettled,
      payoutAlreadyStarted: !['scheduled', 'held'].includes((payoutRow as { state?: string } | null)?.state ?? 'scheduled'),
      completedAt: b?.completed_at ?? null,
    },
    now,
    RENTAL_POLICY.ownerPayoutDelayHours,
  );
  return result.eligible ? { eligible: true, recipientCode: bank_?.paystack_recipient_code ?? null } : { eligible: false, reasons: result.reasons };
}

/** Send approved payouts and reconcile in-flight ones. */
export async function runPayouts(
  db: Admin = createAdminClient(),
  transfers: PayoutPort = payoutPort,
  clock: Clock = systemClock,
  limit = 25,
): Promise<Record<string, number>> {
  const { data, error } = await db.from('owner_payouts').select('id').in('state', ['approved', 'claimed', 'pending', 'received']).eq('provider', transfers.provider).order('scheduled_at').limit(limit);
  if (error) {
    if (isMissingPipeline(error)) return {};
    throw new Error(`payout send queue: ${error.message}`);
  }
  const payouts = new SupabasePayouts(db);
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { id: string }[]) {
    const r = await submitPayout(row.id, { payouts, transfers, clock });
    out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}

/**
 * Overdue ladder (spec §7.13). Marks hires past their return time overdue,
 * then records each escalation stage once, with a reminder to the renter
 * where the stage calls for one and a task for staff. Never accuses, never
 * suspends, never keeps a deposit. People decide those.
 */
export async function runOverdueLadder(db: Admin = createAdminClient(), clock: Clock = systemClock): Promise<{ markedOverdue: number; escalations: number }> {
  const now = clock.now();
  const today = sastDate(now);
  let markedOverdue = 0;

  const { data: late } = await db.from('equipment_bookings').select('id, end_date').eq('status', 'active').lt('end_date', today);
  for (const b of (late ?? []) as { id: string; end_date: string }[]) {
    if (returnDueAt(b.end_date).getTime() > now.getTime()) continue;
    const r = await transitionBookings(db, { ids: [b.id], from: ['active'], to: 'overdue', actor: 'system', actorId: null, reason: 'return time passed' });
    if (r.result === 'missing_pipeline') {
      await db.from('equipment_bookings').update({ status: 'overdue', updated_at: now.toISOString() }).eq('id', b.id).eq('status', 'active');
    }
    markedOverdue += 1;
  }

  const { data: overdue } = await db.from('equipment_bookings').select('id, user_id, end_date').eq('status', 'overdue');
  const rows = (overdue ?? []) as { id: string; user_id: string; end_date: string }[];
  if (rows.length === 0) return { markedOverdue, escalations: 0 };

  const { data: done, error } = await db.from('rental_escalations').select('booking_id, stage').in('booking_id', rows.map((r) => r.id));
  if (error) {
    if (isMissingPipeline(error)) return { markedOverdue, escalations: 0 };
    throw new Error(`rental_escalations: ${error.message}`);
  }
  const doneBy = new Map<string, EscalationStage[]>();
  for (const d of (done ?? []) as { booking_id: string; stage: EscalationStage }[]) doneBy.set(d.booking_id, [...(doneBy.get(d.booking_id) ?? []), d.stage]);

  let escalations = 0;
  for (const b of rows) {
    const due = returnDueAt(b.end_date);
    for (const stage of dueEscalations(due, now, doneBy.get(b.id) ?? [])) {
      const hours = Math.floor((now.getTime() - due.getTime()) / 3_600_000);
      const { error: insErr } = await db.from('rental_escalations').upsert({ booking_id: b.id, stage, hours_late: hours }, { onConflict: 'booking_id,stage', ignoreDuplicates: true });
      if (insErr) continue;
      const rule = ESCALATION_LADDER.find((s) => s.stage === stage);
      await enqueue(db, [
        ...(rule?.renterNotice ? buildNotices({ kind: 'overdue_reminder', userId: b.user_id, bookingIds: [b.id], discriminator: `${b.id}:${stage}` }) : []),
        ...buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [b.id], discriminator: `overdue:${b.id}:${stage}`, data: { what: `overdue_${stage}`, reference: b.id } }),
      ]);
      escalations += 1;
    }
  }
  return { markedOverdue, escalations };
}

/** Collection reminders for today and return reminders for tomorrow, once per booking. Runs at about 07:45 SAST. */
export async function runReminders(db: Admin = createAdminClient(), clock: Clock = systemClock): Promise<{ collection: number; returns: number }> {
  const now = clock.now();
  const today = sastDate(now);
  const tomorrow = sastDate(new Date(now.getTime() + 86_400_000));
  const [{ data: collecting }, { data: returning }] = await Promise.all([
    db.from('equipment_bookings').select('id, user_id').eq('status', 'confirmed').eq('start_date', today),
    db.from('equipment_bookings').select('id, user_id').eq('status', 'active').eq('end_date', tomorrow),
  ]);
  const notices: OutboxMessage[] = [];
  for (const b of (collecting ?? []) as { id: string; user_id: string }[]) {
    notices.push(...buildNotices({ kind: 'collection_reminder', userId: b.user_id, bookingIds: [b.id], discriminator: `${b.id}:${today}` }));
  }
  for (const b of (returning ?? []) as { id: string; user_id: string }[]) {
    notices.push(...buildNotices({ kind: 'return_reminder', userId: b.user_id, bookingIds: [b.id], discriminator: `${b.id}:${tomorrow}` }));
  }
  await enqueue(db, notices);
  return { collection: (collecting ?? []).length, returns: (returning ?? []).length };
}

/**
 * Missed-webhook recovery (spec §7.6, T29). For recent orders still waiting
 * for payment, ask the provider directly. A charge the provider reports as
 * successful goes through exactly the same use case as a webhook, so a webhook
 * arriving later is just a duplicate. Never trusts the browser.
 */
export async function recoverMissedPayments(
  db: Admin = createAdminClient(),
  payments: PaymentPort = paymentPort,
  clock: Clock = systemClock,
  limit = 25,
): Promise<Record<string, number>> {
  const now = clock.now();
  const { data, error } = await db
    .from('rental_payment_intents')
    .select('reference')
    .in('state', ['initiated', 'failed', 'expired'])
    .eq('provider', payments.provider)
    .lt('created_at', new Date(now.getTime() - 10 * 60_000).toISOString())
    .gt('created_at', new Date(now.getTime() - 72 * 3_600_000).toISOString())
    .order('created_at')
    .limit(limit);
  if (error) {
    if (isMissingPipeline(error)) return {};
    throw new Error(`intent recovery queue: ${error.message}`);
  }
  const repo = new SupabaseRentalPayments(db);
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { reference: string }[]) {
    const v = await payments.verifyCharge(row.reference);
    if (!v.ok) {
      const k = v.kind === 'rejected' ? 'not_paid' : 'provider_unreachable';
      out[k] = (out[k] ?? 0) + 1;
      continue;
    }
    if (v.value.status !== 'success') {
      out[`status_${v.value.status || 'unknown'}`] = (out[`status_${v.value.status || 'unknown'}`] ?? 0) + 1;
      continue;
    }
    const outcome = await processChargeEvent(
      {
        kind: 'charge.success',
        reference: row.reference,
        providerTransactionId: v.value.providerTransactionId,
        amountCents: v.value.amountCents,
        currency: v.value.currency,
        metadataUserId: null,
      },
      { repo, clock },
    );
    out[outcome] = (out[outcome] ?? 0) + 1;
  }
  return out;
}
