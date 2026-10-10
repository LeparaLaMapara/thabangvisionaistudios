/**
 * Money use cases for gear hire. They depend only on ports, so the same code
 * runs behind the webhook, the cron worker, the admin queue and, later, the
 * Ubunye agent. Tests drive them with in-memory fakes.
 */

import type {
  Clock,
  IntentRecord,
  PaymentPort,
  PayoutPort,
  PayoutRepository,
  RefundRecord,
  RefundRepository,
  RentalPaymentRepository,
} from '@/lib/core/ports';
import * as L from './ledger';
import { buildNotices, type OutboxMessage } from './notifications';
import { decideCharge, type ChargeEvent } from './payments';
import { applyProviderTransferStatus, mapProviderTransferStatus, nextPayoutAction } from './payouts';
import { applyProviderRefundStatus, mapProviderRefundStatus, matchProviderRefund, nextRefundAction, refundObligationKey } from './refunds';

export type ChargeOutcome =
  | 'confirmed'
  | 'confirmed_late'
  | 'duplicate'
  | 'ignored'
  | 'failure_recorded'
  | 'unknown_reference'
  | 'mismatch_held'
  | 'late_unavailable_refund_due'
  | 'cancelled_refund_due';

/** The journal for a completed refund; none for an order the ledger never held. */
function processedJournal(refund: RefundRecord): ReturnType<typeof L.refundProcessed> | null {
  if (refund.ledgered === false) return null;
  return L.refundProcessed({ refundId: refund.id, bookingGroupId: refund.bookingGroupId, amountCents: refund.amountCents, fromUnallocated: refund.fromUnallocated });
}

function staffAlert(reference: string, what: string): OutboxMessage[] {
  // Staff alerts go to the ops queue (user id 'staff' is resolved to admins by the adapter).
  return buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [], discriminator: `${what}:${reference}`, data: { reference, what } });
}

export async function processChargeEvent(
  event: ChargeEvent,
  deps: {
    repo: RentalPaymentRepository;
    clock: Clock;
    /**
     * Whether an order paid after its hold lapsed may still be confirmed for
     * this renter (trust limit, account holds). The lapsed order stopped
     * counting against the limit, so it is checked again before it comes back.
     */
    lateAllowed?: (intent: IntentRecord) => Promise<boolean>;
  },
): Promise<ChargeOutcome> {
  const intent = await deps.repo.getIntent(event.reference);
  const lines = intent ? await deps.repo.getOrderLines(intent.checkoutGroupId) : { statuses: {}, cancelledByExpiry: 0 };
  const decision = decideCharge(
    intent && {
      reference: intent.reference,
      state: intent.state,
      expectedAmountCents: intent.expectedAmountCents,
      currency: intent.currency,
      userId: intent.userId,
      providerTransactionId: intent.providerTransactionId,
      holdExpiresAt: intent.holdExpiresAt,
    },
    event,
    lines,
    deps.clock.now(),
  );

  const unallocated = async (reason: string, intentState: 'mismatch' | 'refund_due', refundReason: 'late_payment' | 'overpayment'): Promise<'recorded' | 'duplicate'> => {
    if (!intent) throw new Error('unallocated payment needs an intent');
    const refundKey = refundObligationKey(refundReason, event.providerTransactionId);
    return deps.repo.recordUnallocatedPayment({
      reference: event.reference,
      providerTransactionId: event.providerTransactionId,
      amountCents: event.amountCents,
      intentState,
      reason,
      // A mismatch is never refunded automatically: a person checks first.
      refund: intentState === 'refund_due' ? { key: refundKey, reason: refundReason, amountCents: event.amountCents } : null,
      journal: L.unallocatedReceipt({ providerReference: event.providerTransactionId, bookingGroupId: intent.checkoutGroupId, amountCents: event.amountCents, reason }),
      notices: [
        ...staffAlert(event.reference, reason),
        ...(intentState === 'refund_due'
          ? buildNotices({ kind: 'late_payment_refund', userId: intent.userId, bookingIds: intent.bookingIds, discriminator: event.providerTransactionId, data: { amountCents: event.amountCents } })
          : []),
      ],
    });
  };

  switch (decision.action) {
    case 'unknown_reference':
      return 'unknown_reference';
    case 'duplicate':
      return 'duplicate';
    case 'ignore':
      return 'ignored';
    case 'record_failure':
      await deps.repo.recordFailedAttempt(event.reference);
      return 'failure_recorded';
    case 'hold_mismatch': {
      const r = await unallocated(`payment_${decision.why}_mismatch`, 'mismatch', 'overpayment');
      return r === 'duplicate' ? 'duplicate' : 'mismatch_held';
    }
    case 'refund_paid_cancelled': {
      const r = await unallocated('paid_after_cancellation', 'refund_due', 'late_payment');
      return r === 'duplicate' ? 'duplicate' : 'cancelled_refund_due';
    }
    case 'confirm':
    case 'confirm_late': {
      if (!intent) return 'unknown_reference';
      const late = decision.action === 'confirm_late';
      // Also checked when the hold is about to lapse: the database confirms as
      // late if it lapses before the confirm runs, and that must not skip the check.
      const nearExpiry = new Date(intent.holdExpiresAt).getTime() - deps.clock.now().getTime() < 5 * 60_000;
      if ((late || nearExpiry) && deps.lateAllowed && !(await deps.lateAllowed(intent))) {
        // Over the renter's limit now: never reinstate, give the money back.
        const r = await unallocated('late_payment_over_limit', 'refund_due', 'late_payment');
        return r === 'duplicate' ? 'duplicate' : 'late_unavailable_refund_due';
      }
      const outcome = await deps.repo.confirmPayment({
        reference: event.reference,
        providerTransactionId: event.providerTransactionId,
        amountCents: event.amountCents,
        late,
        journal: L.paymentCaptured({
          bookingGroupId: intent.checkoutGroupId,
          providerReference: event.providerTransactionId,
          hireCents: intent.hireCents,
          depositCents: intent.depositCents,
          deliveryFeeCents: intent.deliveryCents,
        }),
        notices: [
          ...buildNotices({ kind: 'payment_received', userId: intent.userId, bookingIds: intent.bookingIds, discriminator: event.providerTransactionId, data: { amountCents: event.amountCents } }),
          ...buildNotices({ kind: 'booking_confirmed', userId: intent.userId, bookingIds: intent.bookingIds, discriminator: intent.checkoutGroupId, data: { delivery: intent.deliveryCents > 0 } }),
        ],
      });
      if (outcome === 'confirmed') return late ? 'confirmed_late' : 'confirmed';
      if (outcome === 'duplicate') return 'duplicate';
      // The stock went to someone else while this payment was late (or the
      // order changed): never double-book, give the money back (spec §7.6).
      const r = await unallocated(outcome === 'unavailable' ? 'late_payment_no_stock' : 'payment_not_confirmable', 'refund_due', 'late_payment');
      return r === 'duplicate' ? 'duplicate' : 'late_unavailable_refund_due';
    }
  }
}

// ── Refunds ──────────────────────────────────────────────────────────────────

export type RefundEventOutcome = 'applied' | 'duplicate' | 'stale' | 'unknown_refund' | 'unknown_status';

export async function processRefundEvent(
  ev: { providerRefundId: string | null; transactionReference: string | null; amountCents: number | null; status: string },
  deps: { refunds: RefundRepository },
): Promise<RefundEventOutcome> {
  const incoming = mapProviderRefundStatus(ev.status);
  if (!incoming) return 'unknown_status';
  const refund = await deps.refunds.findByProvider(ev);
  if (!refund) return 'unknown_refund';

  const update = applyProviderRefundStatus(refund.state, incoming);
  if (!update.apply) return update.reason === 'duplicate' ? 'duplicate' : 'stale';

  const journal =
    update.to === 'processed'
      ? processedJournal(refund)
      : null;
  const notices: OutboxMessage[] = [];
  if (update.notifyCustomer && refund.userId) {
    const kind = update.notifyCustomer === 'processed' ? 'refund_processed' : update.notifyCustomer === 'failed' ? 'refund_failed' : 'refund_initiated';
    notices.push(...buildNotices({ kind, userId: refund.userId, bookingIds: refund.bookingIds, discriminator: refund.id, data: { amountCents: refund.amountCents } }));
  }
  if (update.alertStaff) notices.push(...staffAlert(refund.id, `refund_${update.to}`));

  const moved = await deps.refunds.transition(refund.id, [refund.state], update.to, { providerRefundId: ev.providerRefundId ?? refund.providerRefundId }, journal, notices);
  return moved ? 'applied' : 'duplicate';
}

export type SubmitRefundOutcome = 'submitted' | 'reconciled' | 'waiting' | 'escalated' | 'nothing_to_do' | 'lost_race' | 'unknown_outcome';

/**
 * Move one refund obligation forward. Safe to call any number of times, from
 * any number of workers: the claim is a compare-and-set, and an uncertain
 * earlier call is reconciled with the provider before anything is re-sent
 * (T13).
 */
export async function submitRefund(id: string, deps: { refunds: RefundRepository; payments: PaymentPort; clock: Clock }): Promise<SubmitRefundOutcome> {
  const refund = await deps.refunds.get(id);
  if (!refund) return 'nothing_to_do';
  const next = nextRefundAction(refund, deps.clock.now());

  if (next.action === 'none') return 'nothing_to_do';
  if (next.action === 'wait') return 'waiting';
  if (next.action === 'escalate') {
    if (refund.state === 'eligible') {
      await deps.refunds.transition(refund.id, ['eligible'], 'needs_attention', { lastError: next.why }, null, staffAlert(refund.id, 'refund_attempts_exhausted'));
    }
    return 'escalated';
  }

  if (next.action === 'reconcile_first') {
    const found = await deps.payments.listRefunds(refund.transactionReference);
    if (!found.ok) return 'unknown_outcome';

    // Provider refunds already tied to OTHER obligations cannot be this one.
    const taken = new Set<string>();
    for (const c of found.value) {
      if (!c.providerRefundId || c.providerRefundId === refund.providerRefundId) continue;
      const owner = await deps.refunds.findByProvider({ providerRefundId: c.providerRefundId });
      if (owner && owner.id !== refund.id) taken.add(c.providerRefundId);
    }
    const m = matchProviderRefund(refund, found.value, taken);

    if (m.kind === 'ambiguous') {
      // Two equal refunds on one charge and nothing to tell them apart: a person decides.
      await deps.refunds.transition(refund.id, [refund.state], 'needs_attention', { lastError: 'reconcile: several provider refunds could be this one' }, null, staffAlert(refund.id, 'refund_ambiguous'));
      return 'escalated';
    }

    if (m.kind === 'match') {
      const incoming = mapProviderRefundStatus(m.refund.status) ?? 'pending';
      const inSubmit = refund.state === 'claimed' || refund.state === 'requested';
      const update = inSubmit ? null : applyProviderRefundStatus(refund.state, incoming);
      if (update && !update.apply) return 'waiting';
      const to = update && update.apply ? update.to : incoming;
      const notices: OutboxMessage[] = [];
      if (refund.userId && (to === 'processed' || to === 'failed')) {
        notices.push(...buildNotices({ kind: to === 'processed' ? 'refund_processed' : 'refund_failed', userId: refund.userId, bookingIds: refund.bookingIds, discriminator: refund.id, data: { amountCents: refund.amountCents } }));
      }
      if (to === 'failed' || to === 'needs_attention') notices.push(...staffAlert(refund.id, `refund_${to}`));
      const moved = await deps.refunds.transition(
        refund.id,
        [refund.state],
        to,
        { providerRefundId: m.refund.providerRefundId },
        to === 'processed' ? processedJournal(refund) : null,
        notices,
      );
      return moved ? 'reconciled' : 'lost_race';
    }

    // Not at the provider.
    if (refund.state === 'claimed' || refund.state === 'requested') {
      // The earlier call never reached the provider: release the claim so it can be sent.
      const released = await deps.refunds.transition(refund.id, [refund.state], 'eligible', { lastError: 'reconciled: not found at provider' }, null, []);
      return released ? 'reconciled' : 'lost_race';
    }
    // The provider accepted it earlier but no longer lists it: never resend blind.
    await deps.refunds.transition(refund.id, [refund.state], 'needs_attention', { lastError: 'reconcile: provider no longer lists this refund' }, null, staffAlert(refund.id, 'refund_missing_at_provider'));
    return 'escalated';
  }

  // submit: claim first, so only one worker calls the provider.
  const claimed = await deps.refunds.transition(refund.id, ['eligible'], 'claimed', { claim: true }, null, []);
  if (!claimed) return 'lost_race';

  const res = await deps.payments.refund({ transactionReference: refund.transactionReference, amountCents: refund.amountCents, idempotencyKey: refund.obligationKey });
  if (res.ok) {
    const state = mapProviderRefundStatus(res.value.status) ?? 'requested';
    const to = state === 'processed' ? 'processed' : state === 'failed' ? 'failed' : state === 'needs_attention' ? 'needs_attention' : state === 'processing' ? 'processing' : 'pending';
    // Tell the customer where the refund actually is: a refund the provider
    // settles (or refuses) on the spot gets no later webhook that is not a duplicate.
    const notices: OutboxMessage[] = [];
    if (refund.userId && to !== 'needs_attention') {
      const kind = to === 'processed' ? 'refund_processed' : to === 'failed' ? 'refund_failed' : 'refund_initiated';
      notices.push(...buildNotices({ kind, userId: refund.userId, bookingIds: refund.bookingIds, discriminator: refund.id, data: { amountCents: refund.amountCents } }));
    }
    if (to === 'failed' || to === 'needs_attention') notices.push(...staffAlert(refund.id, `refund_${to}`));
    await deps.refunds.transition(
      refund.id,
      ['claimed'],
      to,
      { providerRefundId: res.value.providerRefundId },
      to === 'processed' ? processedJournal(refund) : null,
      notices,
    );
    return to === 'failed' || to === 'needs_attention' ? 'escalated' : 'submitted';
  }
  if (res.kind === 'rejected') {
    await deps.refunds.transition(
      refund.id,
      ['claimed'],
      'failed',
      { lastError: res.message.slice(0, 500) },
      null,
      [
        ...staffAlert(refund.id, 'refund_rejected'),
        ...(refund.userId ? buildNotices({ kind: 'refund_failed', userId: refund.userId, bookingIds: refund.bookingIds, discriminator: refund.id }) : []),
      ],
    );
    return 'escalated';
  }
  // Unknown: stay `claimed`. The next run reconciles before re-sending.
  return 'unknown_outcome';
}

// ── Payouts ──────────────────────────────────────────────────────────────────

export type TransferEventOutcome = 'applied' | 'duplicate' | 'stale' | 'unknown_payout' | 'unknown_status';

export async function processTransferEvent(
  ev: { reference: string; status: string; transferCode: string | null },
  deps: { payouts: PayoutRepository },
): Promise<TransferEventOutcome> {
  const incoming = mapProviderTransferStatus(ev.status);
  if (!incoming) return 'unknown_status';
  const payout = await deps.payouts.getByReference(ev.reference);
  if (!payout) return 'unknown_payout';
  const update = applyProviderTransferStatus(payout.state, incoming);
  if (!update.apply) return update.reason === 'duplicate' ? 'duplicate' : 'stale';

  const journal =
    update.ledger === 'completed'
      ? L.payoutCompleted({ payoutId: payout.id, bookingGroupId: payout.bookingGroupId, amountCents: payout.amountCents })
      : update.ledger === 'reversed'
        ? L.payoutReversed({ payoutId: payout.id, bookingGroupId: payout.bookingGroupId, amountCents: payout.amountCents })
        : null;
  const notices = transferNotices(payout, update);
  const moved = await deps.payouts.transition(payout.id, [payout.state], update.to, { providerTransferCode: ev.transferCode ?? payout.providerTransferCode }, journal, notices);
  return moved ? 'applied' : 'duplicate';
}

/** The owner's notice and any staff alert for a transfer state change (webhook or immediate answer alike). */
function transferNotices(
  payout: { id: string; ownerId: string; bookingId: string; amountCents: number; transferReference: string },
  update: { to: string; notifyOwner?: 'completed' | 'failed' | null | false; alertStaff?: boolean },
): OutboxMessage[] {
  const notices: OutboxMessage[] = [];
  if (update.notifyOwner) {
    notices.push(
      ...buildNotices({
        kind: update.notifyOwner === 'completed' ? 'payout_completed' : 'payout_failed',
        userId: payout.ownerId,
        bookingIds: [payout.bookingId],
        discriminator: `${payout.id}:${update.to}`,
        data: { amountCents: payout.amountCents },
      }),
    );
  }
  if (update.alertStaff) notices.push(...staffAlert(payout.transferReference, `payout_${update.to}`));
  return notices;
}

export type SubmitPayoutOutcome = 'submitted' | 'reconciled' | 'waiting' | 'escalated' | 'nothing_to_do' | 'lost_race' | 'unknown_outcome' | 'no_recipient';

/** Send an approved payout. The reference never changes, so a retry cannot pay twice (T16). */
export async function submitPayout(id: string, deps: { payouts: PayoutRepository; transfers: PayoutPort; clock: Clock }): Promise<SubmitPayoutOutcome> {
  const payout = await deps.payouts.get(id);
  if (!payout) return 'nothing_to_do';
  const next = nextPayoutAction(payout, deps.clock.now());
  if (next.action === 'none') return 'nothing_to_do';
  if (next.action === 'wait') return 'waiting';
  if (next.action === 'escalate') return 'escalated';

  if (next.action === 'reconcile_first') {
    const found = await deps.transfers.verifyTransfer(payout.transferReference);
    if (!found.ok) return 'unknown_outcome';
    if (found.value) {
      // Same path as a webhook: ledger, owner notice and staff alerts included.
      const outcome = await processTransferEvent(
        { reference: payout.transferReference, status: found.value.status, transferCode: found.value.transferCode },
        { payouts: deps.payouts },
      );
      return outcome === 'applied' ? 'reconciled' : outcome === 'duplicate' || outcome === 'stale' ? 'waiting' : 'unknown_outcome';
    }
    if (payout.state !== 'claimed') {
      // The provider accepted it earlier but has no record now: never resend blind.
      await deps.payouts.transition(payout.id, [payout.state], 'needs_attention', { lastError: 'reconcile: provider has no record of this transfer' }, null, staffAlert(payout.transferReference, 'payout_missing_at_provider'));
      return 'escalated';
    }
    const released = await deps.payouts.transition(payout.id, [payout.state], 'approved', { lastError: 'reconciled: not found at provider' }, null, []);
    return released ? 'reconciled' : 'lost_race';
  }

  if (!payout.recipientCode) return 'no_recipient';
  const claimed = await deps.payouts.transition(payout.id, ['approved'], 'claimed', { claim: true }, null, []);
  if (!claimed) return 'lost_race';

  const res = await deps.transfers.transfer({ reference: payout.transferReference, amountCents: payout.amountCents, recipientCode: payout.recipientCode, reason: 'ThabangVision gear hire earnings' });
  if (res.ok) {
    const state = mapProviderTransferStatus(res.value.status) ?? 'pending';
    const update = applyProviderTransferStatus('claimed', state);
    await deps.payouts.transition(
      payout.id,
      ['claimed'],
      update.apply ? update.to : 'pending',
      { providerTransferCode: res.value.transferCode },
      update.apply && update.ledger === 'completed' ? L.payoutCompleted({ payoutId: payout.id, bookingGroupId: payout.bookingGroupId, amountCents: payout.amountCents }) : null,
      // A transfer that succeeds or fails on the spot gets no later webhook that
      // is not a duplicate, so the owner is told now.
      update.apply ? transferNotices(payout, update) : [],
    );
    return 'submitted';
  }
  if (res.kind === 'rejected') {
    // Refused outright: no transfer exists, so no webhook will follow. Tell the owner now.
    await deps.payouts.transition(payout.id, ['claimed'], 'failed', { lastError: res.message.slice(0, 500) }, null, [
      ...transferNotices(payout, { to: 'failed', notifyOwner: 'failed', alertStaff: false }),
      ...staffAlert(payout.transferReference, 'payout_rejected'),
    ]);
    return 'escalated';
  }
  return 'unknown_outcome';
}
