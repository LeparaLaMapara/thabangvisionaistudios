import { STUDIO } from '@/lib/constants';
import { calculateServiceCancellationRefund, type CancellationQuote } from '@/lib/rental/cancellation';

/**
 * Creative service fulfilment (spec §8.3). Pure: no database, no provider,
 * no framework. Routes read the facts, ask this module what may happen, write
 * the patch it returns with a compare-and-set on the old status, and then
 * carry out the side effects it lists.
 *
 * These are the SERVICE rules (a person's time and work). Gear hire has its
 * own rules in lib/core/rental; nothing here applies to gear.
 *
 * The journey:
 *
 *   pending ──pay──▶ paid ──creator accepts──▶ accepted ──creator delivers──▶ delivered
 *                     │                          ▲                              │
 *                     │ creator declines         └──client asks for a revision──┤ (bounded)
 *                     ▼                                                         │
 *                  declined (full refund)          client approves, or nobody   │
 *                                                  answers within N days ───────▶ completed
 *                                                                                  │
 *                          payout due = completion + payoutDelayHours, if no open dispute
 *                                                                                  ▼
 *                                                                              paid_out
 *
 *   The client may cancel while paid or accepted (refund by the published
 *   cancellation tiers), but only until the work has been delivered once. A
 *   revision request sends the booking back to 'accepted'; that does not
 *   re-open cancellation (see hasBeenDelivered). After a delivery a client
 *   who is unhappy raises a problem instead. A dispute (app/api/disputes)
 *   moves the booking to 'disputed' and holds the payout until a person
 *   resolves it.
 */

export const SERVICE_STATUSES = [
  'pending',
  'paid',
  'accepted',
  'delivered',
  'completed',
  'paid_out',
  'cancelled',
  'declined',
  'disputed',
  'pending_reassignment',
] as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export type ServiceActor = 'client' | 'creator' | 'admin' | 'system';

export type ServiceAction =
  | 'accept'
  | 'decline'
  | 'deliver'
  | 'approve_delivery'
  | 'request_revision'
  | 'auto_approve'
  | 'cancel';

interface Rule {
  actors: readonly ServiceActor[];
  from: readonly ServiceStatus[];
  to: ServiceStatus;
}

/** Who may do what, from which status. Anything not listed is refused. */
export const SERVICE_RULES: Readonly<Record<ServiceAction, Rule>> = {
  accept: { actors: ['creator'], from: ['paid'], to: 'accepted' },
  decline: { actors: ['creator'], from: ['paid'], to: 'declined' },
  deliver: { actors: ['creator'], from: ['accepted'], to: 'delivered' },
  approve_delivery: { actors: ['client'], from: ['delivered'], to: 'completed' },
  request_revision: { actors: ['client'], from: ['delivered'], to: 'accepted' },
  auto_approve: { actors: ['system'], from: ['delivered'], to: 'completed' },
  cancel: { actors: ['client'], from: ['paid', 'accepted'], to: 'cancelled' },
};

export function isServiceStatus(value: unknown): value is ServiceStatus {
  return typeof value === 'string' && (SERVICE_STATUSES as readonly string[]).includes(value);
}

/** What the route knows about a booking when it asks. Amounts are whole rands, as stored. */
export interface ServiceBookingFacts {
  status: string;
  paymentStatus: string | null;
  /** The reference the client's payment was taken under, if any. */
  paymentReference: string | null;
  total: number;
  createdAt: string | null;
  shootDate: string | null;
  deliveredAt: string | null;
  /**
   * The delivery link on record. Written only by the deliver step and never
   * cleared (a revision request clears delivered_at, not this), so it shows
   * the work was delivered at least once.
   */
  deliveryUrl?: string | null;
  /** null on bookings made before migration 073: the default allowance applies. */
  revisionsIncluded: number | null;
  revisionsUsed: number | null;
  /**
   * bookings.cancellation_refund_status as read. A refund already recorded,
   * started or left to a person is never followed by an automatic one (an
   * admin may have refunded part of it through a dispute, then put the
   * booking back): the record is kept and a person decides.
   */
  refundStatus?: string | null;
}

/** A refund already exists on record (or is a person's job): send no automatic one, and keep the record. */
function refundOnRecord(b: ServiceBookingFacts): boolean {
  return refundAlreadyStarted(b.refundStatus) || b.refundStatus === 'manual_review';
}

export type RefundStatus = 'pending' | 'not_required' | 'manual_review';

/**
 * Recorded refund states (bookings.cancellation_refund_status) meaning money
 * has gone back, or may have:
 *   refunded  the provider accepted a refund
 *   unknown   a refund call got no clear answer; it may have gone through
 *   pending   a refund was about to be sent, and no outcome was recorded
 *             (also used for 'unknown' before migration 073 allows it)
 * No automatic refund is sent over one of these (e.g. an admin cancel after a
 * client cancellation): a person checks the provider and refunds any balance
 * by hand. 'failed' (the provider refused, nothing moved) and 'manual_review'
 * are not in the list.
 */
export const REFUND_ALREADY_STARTED = ['refunded', 'unknown', 'pending'] as const;

export function refundAlreadyStarted(status: string | null | undefined): boolean {
  return typeof status === 'string' && (REFUND_ALREADY_STARTED as readonly string[]).includes(status);
}

/**
 * Whether an automatic refund may be claimed over this recorded state: none
 * yet, or the provider refused the last attempt ('failed': nothing moved).
 * Everything else is refused: 'refunded' / 'unknown' / 'pending' (money went
 * back, may have, or is being sent), 'manual_review' (a person is handling it)
 * and 'not_required' (a cancellation already decided nothing goes back).
 */
export function refundClaimable(status: string | null | undefined): boolean {
  return status === null || status === undefined || status === 'failed';
}

/**
 * The creator payout has been sent or is being sent (bookings.payout_status is
 * pending | processing | paid | failed; 'paid_out' is the booking status once
 * it is confirmed). Refunding the client then would pay out twice.
 */
export function payoutAlreadySent(b: { status: string | null; payoutStatus: string | null }): boolean {
  return b.payoutStatus === 'processing' || b.payoutStatus === 'paid' || b.status === 'paid_out';
}

/**
 * What the client is told about money when an admin cancels. An amount is
 * promised only when the provider accepted the refund; anything else (refused,
 * unclear, by hand, already handled elsewhere) gets "our team will be in
 * touch", with no amount.
 */
export function adminCancelRefundLines(
  paid: boolean,
  refund: string | null,
  total: number,
): { short: string; long: string } {
  if (!paid) return { short: '', long: '' };
  if (refund === 'refunded') {
    return {
      short: 'A refund is being processed.',
      long: `A refund of R${total} is being processed to your original payment method. When it shows depends on your bank.`,
    };
  }
  return {
    short: 'Our team will be in touch about your refund.',
    long: 'Our team will be in touch with you about your refund.',
  };
}

export type ServiceRefundRefusalCode = 'PAYOUT_ALREADY_SENT' | 'REFUND_ALREADY_STARTED' | 'REFUND_NEEDS_A_PERSON';

/**
 * Whether an admin refund (admin cancel, dispute resolution) may be started on
 * a service booking. The caller then claims it with a compare-and-set on
 * exactly the states read here (lib/payments/service-refunds.ts), so two
 * admins, or an admin and the client, cannot both send one.
 */
export function checkServiceRefund(b: {
  status: string | null;
  payoutStatus: string | null;
  refundStatus: string | null;
}): { ok: true } | { ok: false; code: ServiceRefundRefusalCode; message: string } {
  if (payoutAlreadySent(b)) {
    return {
      ok: false,
      code: 'PAYOUT_ALREADY_SENT',
      message: 'The creator has already been paid for this booking (or the payout is with the provider), so nothing is refunded automatically. A person decides: check the payout and the payment provider, and refund by hand if the client should get money back.',
    };
  }
  if (refundAlreadyStarted(b.refundStatus)) {
    return {
      ok: false,
      code: 'REFUND_ALREADY_STARTED',
      message: `A refund is already recorded for this booking (${b.refundStatus}). Check the payment provider before refunding anything more.`,
    };
  }
  if (!refundClaimable(b.refundStatus)) {
    return {
      ok: false,
      code: 'REFUND_NEEDS_A_PERSON',
      message: `The refund for this booking is marked '${b.refundStatus}', so it is not refunded automatically. A person decides and records it.`,
    };
  }
  return { ok: true };
}

export interface RefundPlan {
  /** Whole rands to return to the client. */
  amount: number;
  percent: number;
  why: 'creator_declined' | 'client_cancelled';
}

export type TransitionRefusal =
  | 'unknown_action'
  | 'not_allowed_for_actor'
  | 'wrong_status'
  | 'reason_required'
  | 'revisions_exhausted'
  | 'not_yet_due'
  | 'delivery_required'
  | 'already_delivered';

export type TransitionDecision =
  | {
      ok: true;
      action: ServiceAction;
      from: ServiceStatus;
      to: ServiceStatus;
      /** Column values to write with the status (compare-and-set on `from`). */
      patch: Record<string, string | number | null>;
      /** Money to return. null when nothing goes back. */
      refund: RefundPlan | null;
      refundStatus: RefundStatus | null;
      cancellation: CancellationQuote | null;
      notify: ReadonlyArray<'client' | 'creator'>;
      /** A person must look at it (reassignment, a refund to check by hand). */
      alertAdmin: boolean;
    }
  | { ok: false; code: TransitionRefusal; message: string };

const MAX_REASON = 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function cleanReason(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string') return null;
  const t = reason.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, MAX_REASON) : null;
}

/** When the creator payout may be sent: completion + the payout delay. */
export function payoutDueAt(completedAt: Date | string, delayHours: number = STUDIO.booking.payoutDelayHours): Date {
  const t = completedAt instanceof Date ? completedAt.getTime() : new Date(completedAt).getTime();
  return new Date(t + delayHours * HOUR_MS);
}

/** When an unanswered delivery is approved automatically. */
export function autoApproveDueAt(deliveredAt: Date | string, days: number = STUDIO.booking.autoApproveDeliveryAfterDays): Date {
  const t = deliveredAt instanceof Date ? deliveredAt.getTime() : new Date(deliveredAt).getTime();
  return new Date(t + days * DAY_MS);
}

/** Revision rounds a booking includes, with the default for older bookings. */
export function revisionsAllowed(included: number | null | undefined): number {
  return typeof included === 'number' && Number.isInteger(included) && included >= 0
    ? included
    : STUDIO.booking.defaultRevisionsIncluded;
}

/** The revision terms in words, recorded on the booking and shown before paying. */
export function revisionPolicyText(included: number = STUDIO.booking.defaultRevisionsIncluded): string {
  if (included <= 0) {
    return 'No revision rounds are included. Changes after delivery are agreed with the creator.';
  }
  const rounds = included === 1 ? 'one round' : `${included} rounds`;
  return `Includes ${rounds} of revisions: after delivery you can ask the creator for changes before you approve. Further changes are agreed with the creator.`;
}

/**
 * When the creator is paid, in words. States when WE send the payout; never
 * when it arrives, which is up to the bank.
 */
export function payoutTimingText(delayHours: number = STUDIO.booking.payoutDelayHours): string {
  return `The creator's payout is sent ${delayHours} hours after the work is approved, as long as no problem has been raised. When it reaches the bank account depends on the bank.`;
}

/** How approval works, in words, for the booking page. */
export function approvalText(days: number = STUDIO.booking.autoApproveDeliveryAfterDays): string {
  return `After delivery you have ${days} days to approve the work, ask for a revision or raise a problem. If we hear nothing, it is approved automatically.`;
}

/**
 * Whether the creator has delivered the work at least once. Any one durable
 * signal is enough: the delivery link (kept after a revision request), a
 * revision round used (only possible after a delivery), or a current delivery
 * time. Used to refuse a client cancellation after delivery, which would
 * otherwise refund the client for work already handed over.
 */
export function hasBeenDelivered(b: Pick<ServiceBookingFacts, 'deliveredAt' | 'deliveryUrl' | 'revisionsUsed'>): boolean {
  if (b.deliveredAt) return true;
  if (typeof b.deliveryUrl === 'string' && b.deliveryUrl.trim() !== '') return true;
  return typeof b.revisionsUsed === 'number' && b.revisionsUsed > 0;
}

function isPaid(b: ServiceBookingFacts): boolean {
  return b.paymentStatus === 'paid' && Boolean(b.paymentReference);
}

/**
 * Decide one status change. Refuses anything the rules do not allow, so a
 * route cannot invent a transition, and says exactly what to write.
 */
export function decideServiceTransition(input: {
  action: ServiceAction;
  actor: ServiceActor;
  booking: ServiceBookingFacts;
  now: Date;
  reason?: string | null;
  /** deliver only: where the client collects the work. */
  delivery?: { url: string; message?: string | null } | null;
}): TransitionDecision {
  const { action, actor, booking, now } = input;
  const rule = (SERVICE_RULES as Record<string, Rule | undefined>)[action];
  if (!rule) return { ok: false, code: 'unknown_action', message: `Unknown action '${String(action)}'` };
  if (!rule.actors.includes(actor)) {
    return { ok: false, code: 'not_allowed_for_actor', message: `A ${actor} cannot ${action.replace(/_/g, ' ')} a booking` };
  }
  if (!isServiceStatus(booking.status) || !rule.from.includes(booking.status)) {
    return { ok: false, code: 'wrong_status', message: `Cannot ${action.replace(/_/g, ' ')} a booking that is '${booking.status}'` };
  }

  const from = booking.status;
  const at = now.toISOString();
  const reason = cleanReason(input.reason);
  const base = { ok: true as const, action, from, to: rule.to, refund: null, refundStatus: null, cancellation: null, alertAdmin: false };

  switch (action) {
    case 'accept':
      return { ...base, patch: { accepted_at: at }, notify: ['client'] };

    case 'decline': {
      // The creator turned the request down: the client gets everything back.
      const paid = isPaid(booking);
      const amount = Math.max(0, Math.round(booking.total));
      if (paid && refundOnRecord(booking)) {
        return { ...base, patch: { declined_at: at, decline_reason: reason }, refund: null, refundStatus: null, notify: ['client'], alertAdmin: true };
      }
      return {
        ...base,
        patch: {
          declined_at: at,
          decline_reason: reason,
          cancellation_refund_percent: paid ? 100 : null,
          cancellation_refund_amount: paid ? amount : null,
          cancellation_refund_status: paid && amount > 0 ? 'pending' : 'not_required',
        },
        refund: paid && amount > 0 ? { amount, percent: 100, why: 'creator_declined' } : null,
        refundStatus: paid && amount > 0 ? 'pending' : 'not_required',
        notify: ['client'],
        // A person offers the client another creator or confirms the refund.
        alertAdmin: true,
      };
    }

    case 'deliver': {
      const url = input.delivery?.url?.trim() ?? '';
      if (!isDeliveryUrl(url)) {
        return { ok: false, code: 'delivery_required', message: 'A valid delivery link (https://…) is required' };
      }
      return {
        ...base,
        patch: {
          delivered_at: at,
          delivery_url: url,
          delivery_message: cleanReason(input.delivery?.message ?? null),
        },
        notify: ['client'],
      };
    }

    case 'approve_delivery':
    case 'auto_approve': {
      if (action === 'auto_approve') {
        if (!booking.deliveredAt || autoApproveDueAt(booking.deliveredAt).getTime() > now.getTime()) {
          return { ok: false, code: 'not_yet_due', message: 'The client still has time to respond to this delivery' };
        }
      }
      const due = payoutDueAt(now).toISOString();
      return {
        ...base,
        patch: {
          completed_at: at,
          accepted_by_client_at: action === 'approve_delivery' ? at : null,
          payout_due_at: due,
          dispute_window_ends_at: due,
        },
        notify: action === 'approve_delivery' ? ['creator'] : ['client', 'creator'],
      };
    }

    case 'request_revision': {
      if (!reason) {
        return { ok: false, code: 'reason_required', message: 'Tell the creator what to change' };
      }
      const used = Math.max(0, booking.revisionsUsed ?? 0);
      const allowed = revisionsAllowed(booking.revisionsIncluded);
      if (used >= allowed) {
        return {
          ok: false,
          code: 'revisions_exhausted',
          message: allowed === 0
            ? 'This booking includes no revision rounds. Approve the work or raise a problem.'
            : `All ${allowed} revision round${allowed === 1 ? '' : 's'} have been used. Approve the work or raise a problem.`,
        };
      }
      return {
        ...base,
        // delivered_at is cleared so the approval clock restarts on the next delivery.
        patch: { revisions_used: used + 1, delivered_at: null },
        notify: ['creator'],
      };
    }

    case 'cancel': {
      // After delivery the client cannot cancel (docs/marketplace/services.md):
      // a revision request puts the booking back in 'accepted', but the work
      // was handed over, so a problem goes to a person through a dispute.
      if (hasBeenDelivered(booking)) {
        return {
          ok: false,
          code: 'already_delivered',
          message: 'The work has already been delivered, so this booking can no longer be cancelled. If something is wrong, raise a problem and our team will look at it.',
        };
      }
      if (isPaid(booking) && refundOnRecord(booking)) {
        return { ...base, patch: { cancelled_at: at, cancellation_reason: reason }, refund: null, refundStatus: null, cancellation: null, notify: ['creator'], alertAdmin: true };
      }
      const quote = calculateServiceCancellationRefund({
        shootDate: booking.shootDate,
        total: Number(booking.total ?? 0),
        bookedAt: booking.createdAt,
        now,
      });
      const paid = isPaid(booking);
      let refundStatus: RefundStatus;
      if (!paid) refundStatus = 'not_required';
      else if (!quote) refundStatus = 'manual_review';
      else refundStatus = quote.totalRefund > 0 ? 'pending' : 'not_required';

      const patch: Record<string, string | number | null> = {
        cancelled_at: at,
        cancellation_reason: reason,
        cancellation_refund_status: refundStatus,
      };
      if (paid && quote) {
        patch.cancellation_refund_percent = quote.refundPercent;
        patch.cancellation_refund_amount = quote.totalRefund;
      }
      return {
        ...base,
        patch,
        refund: refundStatus === 'pending' && quote ? { amount: quote.totalRefund, percent: quote.refundPercent, why: 'client_cancelled' } : null,
        refundStatus,
        cancellation: quote,
        notify: ['creator'],
        alertAdmin: true,
      };
    }
  }
}

/**
 * Which action a status-route request means. Accepts the explicit `action`
 * and the older `status` form the dashboards send. A creator's 'cancelled'
 * is a decline: that is what the old Decline button sent, and it used to fail.
 * Delivery has its own endpoint (it needs a link), so 'delivered' is refused.
 */
export function serviceActionFromRequest(
  role: 'client' | 'creator',
  body: { status?: unknown; action?: unknown },
): ServiceAction | null {
  const allowed: Record<'client' | 'creator', readonly ServiceAction[]> = {
    creator: ['accept', 'decline'],
    client: ['approve_delivery', 'request_revision', 'cancel'],
  };
  if (typeof body.action === 'string') {
    return (allowed[role] as readonly string[]).includes(body.action) ? (body.action as ServiceAction) : null;
  }
  const status = typeof body.status === 'string' ? body.status : '';
  if (role === 'creator') {
    if (status === 'accepted') return 'accept';
    if (status === 'declined' || status === 'cancelled') return 'decline';
    return null;
  }
  if (status === 'completed') return 'approve_delivery';
  if (status === 'revision_requested') return 'request_revision';
  if (status === 'cancelled') return 'cancel';
  return null;
}

/** A link the client can open: absolute http(s) only. */
export function isDeliveryUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Whether a party may still raise a problem. Open while the work is being
 * delivered or awaiting approval, and after completion until the dispute
 * window closes (which is when the payout becomes due). Once the payout has
 * been sent, a problem is a matter for a person, not an automatic hold.
 */
export function canRaiseServiceDispute(
  b: { status: string; disputeWindowEndsAt: string | null; completedAt: string | null; payoutStatus: string | null },
  now: Date,
): boolean {
  if (['accepted', 'delivered'].includes(b.status)) return true;
  if (b.status !== 'completed') return false;
  if (b.payoutStatus === 'processing' || b.payoutStatus === 'paid') return false;
  const ends = b.disputeWindowEndsAt
    ? new Date(b.disputeWindowEndsAt)
    : b.completedAt
      ? payoutDueAt(b.completedAt)
      : null;
  return Boolean(ends && ends.getTime() > now.getTime());
}

// ── Payout eligibility ───────────────────────────────────────────────────────

export interface ServicePayoutFacts {
  status: string | null;
  paymentStatus: string | null;
  payoutStatus: string | null;
  creatorId: string | null;
  /** The creator passed the ID check. */
  creatorVerified: boolean;
  /** The bank account was validated against the creator and a recipient exists. */
  payoutAccountValidated: boolean;
  creatorAmount: number | null;
  total: number | null;
  /** What the payment provider says about the client's payment (rands). null = could not ask. */
  providerConfirmation: { success: boolean; amount: number } | null;
  /** Open disputes for this booking. null = the lookup failed, which holds the payout. */
  openDisputes: number | null;
  completedAt: string | null;
  payoutDueAt: string | null;
  /**
   * bookings.cancellation_refund_status. Any refund recorded or started
   * (anything but null / 'not_required') holds the payout for a person: the
   * client has been, or may be, refunded, and creator_amount is not adjusted.
   */
  refundStatus?: string | null;
}

export type ServicePayoutBlock =
  | 'no_creator'
  | 'creator_not_verified'
  | 'payout_account_not_validated'
  | 'booking_not_completed'
  | 'payment_not_marked_paid'
  | 'payment_not_confirmed'
  | 'payment_less_than_total'
  | 'invalid_creator_amount'
  | 'open_dispute'
  | 'dispute_check_failed'
  | 'already_paid'
  | 'refund_recorded'
  | 'no_completion_time'
  | 'not_due_yet';

export type ServicePayoutEligibility =
  | { eligible: true; dueAt: Date }
  | { eligible: false; reasons: ServicePayoutBlock[]; dueAt: Date | null };

/**
 * Every condition must hold before a creator is paid; each failed one is
 * listed. A lookup that failed counts as a blocker (fail closed).
 */
export function checkServicePayoutEligibility(f: ServicePayoutFacts, now: Date): ServicePayoutEligibility {
  const reasons: ServicePayoutBlock[] = [];
  if (!f.creatorId) reasons.push('no_creator');
  if (!f.creatorVerified) reasons.push('creator_not_verified');
  if (!f.payoutAccountValidated) reasons.push('payout_account_not_validated');
  if (f.status !== 'completed') reasons.push('booking_not_completed');
  if (f.paymentStatus !== 'paid') reasons.push('payment_not_marked_paid');
  if (f.payoutStatus === 'paid') reasons.push('already_paid');
  if (f.refundStatus !== null && f.refundStatus !== undefined && f.refundStatus !== 'not_required') reasons.push('refund_recorded');

  const amount = Number(f.creatorAmount ?? 0);
  const total = Number(f.total ?? 0);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(total) || total <= 0 || amount > total) {
    reasons.push('invalid_creator_amount');
  }
  if (!f.providerConfirmation || !f.providerConfirmation.success) reasons.push('payment_not_confirmed');
  else if (Math.round(f.providerConfirmation.amount) < total) reasons.push('payment_less_than_total');

  if (f.openDisputes === null) reasons.push('dispute_check_failed');
  else if (f.openDisputes > 0) reasons.push('open_dispute');

  const dueAt = f.payoutDueAt ? new Date(f.payoutDueAt) : f.completedAt ? payoutDueAt(f.completedAt) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) reasons.push('no_completion_time');
  else if (dueAt.getTime() > now.getTime()) reasons.push('not_due_yet');

  const validDue = dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null;
  return reasons.length ? { eligible: false, reasons, dueAt: validDue } : { eligible: true, dueAt: validDue as Date };
}

/** Plain words for the admin digest. */
export const PAYOUT_BLOCK_WORDS: Readonly<Record<ServicePayoutBlock, string>> = {
  no_creator: 'no creator on the booking',
  creator_not_verified: 'the creator has not passed the ID check',
  payout_account_not_validated: 'the creator has no validated bank account',
  booking_not_completed: 'the booking is not completed',
  payment_not_marked_paid: 'the booking is not marked paid',
  payment_not_confirmed: 'the payment provider does not confirm the payment',
  payment_less_than_total: 'the provider confirms less than the booking total',
  invalid_creator_amount: 'the creator amount is missing or more than the total',
  open_dispute: 'a dispute is open',
  dispute_check_failed: 'disputes could not be checked',
  already_paid: 'already paid',
  refund_recorded: 'a refund to the client is recorded or under way; a person decides the payout',
  no_completion_time: 'no completion time on record',
  not_due_yet: 'not due yet',
};
