import { describe, it, expect } from 'vitest';
import { STUDIO } from '@/lib/constants';
import {
  approvalText,
  autoApproveDueAt,
  canRaiseServiceDispute,
  checkServicePayoutEligibility,
  decideServiceTransition,
  hasBeenDelivered,
  payoutDueAt,
  refundAlreadyStarted,
  payoutTimingText,
  revisionPolicyText,
  revisionsAllowed,
  serviceActionFromRequest,
  SERVICE_RULES,
  type ServiceAction,
  type ServiceActor,
  type ServiceBookingFacts,
  type ServicePayoutFacts,
} from '@/lib/core/services/fulfilment';
import {
  afterServicePayoutLookup,
  isStableServicePayoutReference,
  nextServicePayoutStep,
  servicePayoutReference,
} from '@/lib/core/services/payouts';

const NOW = new Date('2026-10-09T10:00:00.000Z');
const H = 3_600_000;
const iso = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString();
const BOOKING_ID = '9b2f1c3e-0000-4000-8000-000000000001';

const facts = (over: Partial<ServiceBookingFacts> = {}): ServiceBookingFacts => ({
  status: 'paid',
  paymentStatus: 'paid',
  paymentReference: 'BK-abc',
  total: 3000,
  createdAt: iso(-30 * 24 * H),
  shootDate: '2026-11-20',
  deliveredAt: null,
  revisionsIncluded: 1,
  revisionsUsed: 0,
  ...over,
});

const decide = (action: ServiceAction, actor: ServiceActor, over: Partial<ServiceBookingFacts> = {}, extra: { reason?: string | null; delivery?: { url: string } } = {}) =>
  decideServiceTransition({ action, actor, booking: facts(over), now: NOW, ...extra });

describe('the service state machine: who may do what, from where', () => {
  it('lets the creator accept or decline only a paid request', () => {
    expect(decide('accept', 'creator')).toMatchObject({ ok: true, from: 'paid', to: 'accepted', patch: { accepted_at: NOW.toISOString() } });
    expect(decide('decline', 'creator')).toMatchObject({ ok: true, from: 'paid', to: 'declined' });
    for (const status of ['pending', 'accepted', 'delivered', 'completed', 'cancelled', 'declined']) {
      expect(decide('accept', 'creator', { status })).toMatchObject({ ok: false, code: 'wrong_status' });
      expect(decide('decline', 'creator', { status })).toMatchObject({ ok: false, code: 'wrong_status' });
    }
  });

  it('refuses every action to the wrong actor', () => {
    const actors: ServiceActor[] = ['client', 'creator', 'admin', 'system'];
    for (const [action, rule] of Object.entries(SERVICE_RULES) as [ServiceAction, (typeof SERVICE_RULES)[ServiceAction]][]) {
      for (const actor of actors.filter((a) => !rule.actors.includes(a))) {
        const r = decide(action, actor, { status: rule.from[0] });
        expect(r, `${actor} ${action}`).toMatchObject({ ok: false, code: 'not_allowed_for_actor' });
      }
    }
  });

  it('a creator cannot cancel, approve or complete; a client cannot accept or deliver', () => {
    expect(decide('cancel', 'creator')).toMatchObject({ ok: false });
    expect(decide('approve_delivery', 'creator', { status: 'delivered' })).toMatchObject({ ok: false });
    expect(decide('accept', 'client')).toMatchObject({ ok: false });
    expect(decide('deliver', 'client', { status: 'accepted' }, { delivery: { url: 'https://x.test/a' } })).toMatchObject({ ok: false });
  });

  it('deliver needs an accepted booking and a real link', () => {
    expect(decide('deliver', 'creator', { status: 'accepted' }, { delivery: { url: 'https://drive.example/folder' } })).toMatchObject({
      ok: true, to: 'delivered', patch: { delivered_at: NOW.toISOString(), delivery_url: 'https://drive.example/folder' },
    });
    expect(decide('deliver', 'creator', { status: 'accepted' }, { delivery: { url: 'javascript:alert(1)' } })).toMatchObject({ ok: false, code: 'delivery_required' });
    expect(decide('deliver', 'creator', { status: 'accepted' })).toMatchObject({ ok: false, code: 'delivery_required' });
    expect(decide('deliver', 'creator', { status: 'paid' }, { delivery: { url: 'https://x.test' } })).toMatchObject({ ok: false, code: 'wrong_status' });
  });
});

describe('creator decline', () => {
  it('refunds a paid booking in full, records why, and alerts a person to reassign', () => {
    const r = decide('decline', 'creator', {}, { reason: '  double booked   that day ' });
    expect(r).toMatchObject({
      ok: true,
      to: 'declined',
      refund: { amount: 3000, percent: 100, why: 'creator_declined' },
      refundStatus: 'pending',
      alertAdmin: true,
      notify: ['client'],
      patch: { decline_reason: 'double booked that day', cancellation_refund_percent: 100, cancellation_refund_amount: 3000, cancellation_refund_status: 'pending' },
    });
  });

  it('refunds in full even inside the non-refundable window (the creator, not the client, withdrew)', () => {
    const r = decide('decline', 'creator', { shootDate: iso(2 * H).slice(0, 10), createdAt: iso(-60 * 24 * H) });
    expect(r).toMatchObject({ ok: true, refund: { amount: 3000, percent: 100 } });
  });

  it('owes nothing when nothing was paid', () => {
    expect(decide('decline', 'creator', { paymentStatus: 'unpaid', paymentReference: null })).toMatchObject({ ok: true, refund: null, refundStatus: 'not_required' });
  });
});

describe('client acceptance, revisions and automatic approval', () => {
  it('approving a delivery records acceptance and schedules the payout 72 hours later; it does not pay', () => {
    const r = decide('approve_delivery', 'client', { status: 'delivered', deliveredAt: iso(-H) });
    expect(STUDIO.booking.payoutDelayHours).toBe(72);
    const due = new Date(NOW.getTime() + 72 * H).toISOString();
    expect(r).toMatchObject({
      ok: true,
      to: 'completed',
      refund: null,
      notify: ['creator'],
      patch: { completed_at: NOW.toISOString(), accepted_by_client_at: NOW.toISOString(), payout_due_at: due, dispute_window_ends_at: due },
    });
  });

  it('a revision sends the work back to the creator and restarts the approval clock', () => {
    const r = decide('request_revision', 'client', { status: 'delivered', deliveredAt: iso(-H) }, { reason: 'Please brighten the group shots' });
    expect(r).toMatchObject({ ok: true, to: 'accepted', notify: ['creator'], patch: { revisions_used: 1, delivered_at: null } });
  });

  it('a revision needs a reason and is bounded by the allowance', () => {
    expect(decide('request_revision', 'client', { status: 'delivered' }, { reason: '   ' })).toMatchObject({ ok: false, code: 'reason_required' });
    expect(decide('request_revision', 'client', { status: 'delivered', revisionsUsed: 1, revisionsIncluded: 1 }, { reason: 'again' })).toMatchObject({ ok: false, code: 'revisions_exhausted' });
    expect(decide('request_revision', 'client', { status: 'delivered', revisionsUsed: 0, revisionsIncluded: 0 }, { reason: 'again' })).toMatchObject({ ok: false, code: 'revisions_exhausted' });
    expect(decide('request_revision', 'client', { status: 'delivered', revisionsUsed: 1, revisionsIncluded: 2 }, { reason: 'again' })).toMatchObject({ ok: true, patch: { revisions_used: 2 } });
  });

  it('older bookings without a recorded allowance get the default', () => {
    expect(revisionsAllowed(null)).toBe(STUDIO.booking.defaultRevisionsIncluded);
    expect(revisionsAllowed(3)).toBe(3);
    expect(decide('request_revision', 'client', { status: 'delivered', revisionsIncluded: null, revisionsUsed: null }, { reason: 'x' }).ok)
      .toBe(STUDIO.booking.defaultRevisionsIncluded > 0);
  });

  it('auto-approves only after the response window, without recording a client acceptance', () => {
    const days = STUDIO.booking.autoApproveDeliveryAfterDays;
    expect(decide('auto_approve', 'system', { status: 'delivered', deliveredAt: iso(-(days * 24 - 1) * H) })).toMatchObject({ ok: false, code: 'not_yet_due' });
    expect(decide('auto_approve', 'system', { status: 'delivered', deliveredAt: null })).toMatchObject({ ok: false, code: 'not_yet_due' });
    const r = decide('auto_approve', 'system', { status: 'delivered', deliveredAt: iso(-(days * 24 + 1) * H) });
    expect(r).toMatchObject({ ok: true, to: 'completed', notify: ['client', 'creator'], patch: { accepted_by_client_at: null, payout_due_at: new Date(NOW.getTime() + 72 * H).toISOString() } });
    expect(autoApproveDueAt('2026-10-01T00:00:00.000Z', 7).toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
});

describe('client cancellation reuses the published tiers', () => {
  it('refunds in full with 48+ hours notice', () => {
    const r = decide('cancel', 'client', { shootDate: '2026-10-20' });
    expect(r).toMatchObject({ ok: true, to: 'cancelled', refundStatus: 'pending', refund: { amount: 3000, percent: 100, why: 'client_cancelled' } });
  });

  it('refunds nothing inside 24 hours (outside the cooling-off period)', () => {
    const shoot = '2026-10-10'; // starts 2026-10-09T22:00Z, 12 hours away
    const r = decide('cancel', 'client', { shootDate: shoot });
    expect(r).toMatchObject({ ok: true, refund: null, refundStatus: 'not_required' });
  });

  it('sends a booking with no shoot date to a person', () => {
    expect(decide('cancel', 'client', { shootDate: null })).toMatchObject({ ok: true, refund: null, refundStatus: 'manual_review' });
  });

  it('cannot cancel once delivered: approve, ask for a revision or dispute instead', () => {
    expect(decide('cancel', 'client', { status: 'delivered' })).toMatchObject({ ok: false, code: 'wrong_status' });
  });

  it('cannot cancel after a revision request sent a delivered booking back to accepted', () => {
    // request_revision: delivered -> accepted, clears delivered_at, uses a round.
    const revised = decide('request_revision', 'client', { status: 'delivered', deliveredAt: iso(-H), deliveryUrl: 'https://example.invalid/w' }, { reason: 'Brighter' });
    expect(revised).toMatchObject({ ok: true, to: 'accepted', patch: { delivered_at: null, revisions_used: 1 } });
    // Shoot date far ahead: before the fix this refunded 100% automatically.
    const r = decide('cancel', 'client', { status: 'accepted', deliveredAt: null, revisionsUsed: 1, deliveryUrl: 'https://example.invalid/w', shootDate: '2026-12-20' });
    expect(r).toMatchObject({ ok: false, code: 'already_delivered' });
  });

  it('any one durable delivery signal is enough to refuse the cancellation', () => {
    for (const over of [
      { deliveryUrl: 'https://example.invalid/w' },
      { revisionsUsed: 1 },
      { deliveredAt: iso(-H) },
    ] satisfies Partial<ServiceBookingFacts>[]) {
      expect(decide('cancel', 'client', { status: 'accepted', ...over })).toMatchObject({ ok: false, code: 'already_delivered' });
    }
  });

  it('inside the cooling-off period too: delivered work is not cancelled for a refund', () => {
    const r = decide('cancel', 'client', { status: 'accepted', createdAt: iso(-2 * 24 * H), revisionsUsed: 1, shootDate: null });
    expect(r).toMatchObject({ ok: false, code: 'already_delivered' });
  });

  it('a booking never delivered can still be cancelled from accepted', () => {
    expect(decide('cancel', 'client', { status: 'accepted', deliveryUrl: null, revisionsUsed: 0 })).toMatchObject({ ok: true, to: 'cancelled' });
    expect(decide('cancel', 'client', { status: 'accepted', deliveryUrl: '  ', revisionsUsed: null })).toMatchObject({ ok: true, to: 'cancelled' });
  });
});

describe('hasBeenDelivered / refundAlreadyStarted', () => {
  it('reads the durable delivery signals', () => {
    expect(hasBeenDelivered({ deliveredAt: null, deliveryUrl: null, revisionsUsed: 0 })).toBe(false);
    expect(hasBeenDelivered({ deliveredAt: null, revisionsUsed: null })).toBe(false);
    expect(hasBeenDelivered({ deliveredAt: null, deliveryUrl: 'https://x.invalid', revisionsUsed: 0 })).toBe(true);
    expect(hasBeenDelivered({ deliveredAt: null, deliveryUrl: null, revisionsUsed: 2 })).toBe(true);
  });

  it('a refund recorded as made, possibly made or about to be made blocks another one', () => {
    for (const s of ['refunded', 'unknown', 'pending']) expect(refundAlreadyStarted(s)).toBe(true);
    for (const s of ['failed', 'manual_review', 'not_required', null, undefined]) expect(refundAlreadyStarted(s)).toBe(false);
  });
});

describe('reading a request', () => {
  it('maps the dashboards\' status values to actions', () => {
    expect(serviceActionFromRequest('creator', { status: 'accepted' })).toBe('accept');
    // The old Decline button sent 'cancelled', which used to fail with a 400.
    expect(serviceActionFromRequest('creator', { status: 'cancelled' })).toBe('decline');
    expect(serviceActionFromRequest('creator', { status: 'declined' })).toBe('decline');
    expect(serviceActionFromRequest('client', { status: 'completed' })).toBe('approve_delivery');
    expect(serviceActionFromRequest('client', { status: 'cancelled' })).toBe('cancel');
    expect(serviceActionFromRequest('client', { status: 'revision_requested' })).toBe('request_revision');
  });

  it('refuses actions the role does not have and unknown values', () => {
    expect(serviceActionFromRequest('client', { action: 'accept' })).toBeNull();
    expect(serviceActionFromRequest('creator', { action: 'approve_delivery' })).toBeNull();
    expect(serviceActionFromRequest('creator', { action: 'auto_approve' })).toBeNull();
    expect(serviceActionFromRequest('creator', { status: 'completed' })).toBeNull();
    expect(serviceActionFromRequest('client', { status: 'paid_out' })).toBeNull();
    expect(serviceActionFromRequest('client', {})).toBeNull();
  });
});

describe('disputes', () => {
  const b = { status: 'completed', disputeWindowEndsAt: iso(10 * H), completedAt: iso(-62 * H), payoutStatus: 'pending' };
  it('can be raised during the work and inside the window after completion', () => {
    expect(canRaiseServiceDispute({ ...b, status: 'delivered' }, NOW)).toBe(true);
    expect(canRaiseServiceDispute(b, NOW)).toBe(true);
  });
  it('the window closes when the payout is due or sent', () => {
    expect(canRaiseServiceDispute({ ...b, disputeWindowEndsAt: iso(-H) }, NOW)).toBe(false);
    expect(canRaiseServiceDispute({ ...b, payoutStatus: 'processing' }, NOW)).toBe(false);
    expect(canRaiseServiceDispute({ ...b, disputeWindowEndsAt: null, completedAt: iso(-73 * H) }, NOW)).toBe(false);
    expect(canRaiseServiceDispute({ ...b, status: 'paid_out' }, NOW)).toBe(false);
  });
});

describe('payout eligibility (all must hold, each failure named)', () => {
  const ok: ServicePayoutFacts = {
    status: 'completed',
    paymentStatus: 'paid',
    payoutStatus: 'pending',
    creatorId: 'c1',
    creatorVerified: true,
    payoutAccountValidated: true,
    creatorAmount: 2550,
    total: 3000,
    providerConfirmation: { success: true, amount: 3000 },
    openDisputes: 0,
    completedAt: iso(-73 * H),
    payoutDueAt: iso(-H),
  };

  it('is eligible once due with every condition met', () => {
    expect(checkServicePayoutEligibility(ok, NOW)).toEqual({ eligible: true, dueAt: new Date(iso(-H)) });
  });

  it('is not due until 72 hours after completion', () => {
    const r = checkServicePayoutEligibility({ ...ok, completedAt: iso(-71 * H), payoutDueAt: null }, NOW);
    expect(r).toMatchObject({ eligible: false, reasons: ['not_due_yet'] });
    expect(payoutDueAt(iso(-71 * H)).toISOString()).toBe(iso(H));
  });

  it('an open dispute holds it, and a failed dispute lookup holds it too', () => {
    expect(checkServicePayoutEligibility({ ...ok, openDisputes: 1 }, NOW)).toMatchObject({ eligible: false, reasons: ['open_dispute'] });
    expect(checkServicePayoutEligibility({ ...ok, openDisputes: null }, NOW)).toMatchObject({ eligible: false, reasons: ['dispute_check_failed'] });
  });

  it('names every failed condition', () => {
    const r = checkServicePayoutEligibility(
      { ...ok, status: 'disputed', paymentStatus: 'refunded', creatorVerified: false, payoutAccountValidated: false, providerConfirmation: null, creatorAmount: 5000, payoutDueAt: null, completedAt: null, payoutStatus: 'paid' },
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.eligible ? [] : r.reasons).toEqual(expect.arrayContaining([
      'booking_not_completed', 'payment_not_marked_paid', 'creator_not_verified', 'payout_account_not_validated',
      'payment_not_confirmed', 'invalid_creator_amount', 'no_completion_time', 'already_paid',
    ]));
  });

  it('refuses when the provider confirms less than the total', () => {
    expect(checkServicePayoutEligibility({ ...ok, providerConfirmation: { success: true, amount: 100 } }, NOW)).toMatchObject({ eligible: false, reasons: ['payment_less_than_total'] });
  });
});

describe('wording never promises a bank arrival time', () => {
  it('says when we send, and that arrival is up to the bank', () => {
    for (const text of [payoutTimingText(), approvalText(), revisionPolicyText(), revisionPolicyText(0), revisionPolicyText(2)]) {
      expect(text).not.toMatch(/business days?|within \d+ (hours|days) .*account|will (reflect|arrive)/i);
    }
    expect(payoutTimingText()).toMatch(/72 hours/);
    expect(payoutTimingText()).toMatch(/depends on the bank/);
  });
});

describe('stable payout references', () => {
  it('one reference per booking, forever, in the provider\'s format', () => {
    const ref = servicePayoutReference(BOOKING_ID);
    expect(ref).toBe('tvsp_9b2f1c3e000040008000000000000001');
    expect(ref).toBe(servicePayoutReference(BOOKING_ID));
    expect(ref).toMatch(/^[a-z0-9_-]{16,50}$/);
    expect(isStableServicePayoutReference(ref)).toBe(true);
    expect(isStableServicePayoutReference('payout-BK-abc-lzx1')).toBe(false);
  });

  const state = (over: Partial<Parameters<typeof nextServicePayoutStep>[0]> = {}) => ({
    bookingId: BOOKING_ID, payoutStatus: 'pending', payoutReference: null, claimedAt: null, attempts: 0, ...over,
  });
  const opts = { maxAttempts: 3 };
  const stable = servicePayoutReference(BOOKING_ID);

  it('sends a first payout under the stable reference', () => {
    expect(nextServicePayoutStep(state(), NOW, opts)).toEqual({ step: 'send', reference: stable });
    expect(nextServicePayoutStep(state({ payoutStatus: null }), NOW, opts)).toEqual({ step: 'send', reference: stable });
  });

  it('never re-sends blind: a failed or stale payout is looked up first', () => {
    expect(nextServicePayoutStep(state({ payoutStatus: 'failed', payoutReference: stable, attempts: 1 }), NOW, opts)).toEqual({ step: 'lookup', reference: stable });
    expect(nextServicePayoutStep(state({ payoutStatus: 'processing', payoutReference: stable, claimedAt: iso(-2 * H) }), NOW, opts)).toEqual({ step: 'lookup', reference: stable });
    expect(nextServicePayoutStep(state({ payoutStatus: 'processing', payoutReference: stable, claimedAt: iso(-60_000) }), NOW, opts)).toMatchObject({ step: 'wait' });
  });

  it('a legacy reference is looked up; after retries under the old scheme a person decides', () => {
    expect(nextServicePayoutStep(state({ payoutStatus: 'failed', payoutReference: 'payout-BK-abc-lzx1', attempts: 0 }), NOW, opts)).toEqual({ step: 'lookup', reference: 'payout-BK-abc-lzx1' });
    expect(nextServicePayoutStep(state({ payoutStatus: 'failed', payoutReference: 'payout-BK-abc-lzx1', attempts: 1 }), NOW, opts)).toMatchObject({ step: 'escalate' });
    // Same rule while 'processing': an earlier retry may have paid under a
    // reference we no longer hold. (Previously this looked up only the last
    // reference and, if not found, sent under the stable one.)
    expect(nextServicePayoutStep(state({ payoutStatus: 'processing', payoutReference: 'payout-BK-abc-lzx1', claimedAt: iso(-48 * H), attempts: 2 }), NOW, opts)).toMatchObject({ step: 'escalate' });
    // No retries under the old scheme: the one reference is all there is, so a lookup is safe.
    expect(nextServicePayoutStep(state({ payoutStatus: 'processing', payoutReference: 'payout-BK-abc-lzx1', claimedAt: iso(-48 * H), attempts: 0 }), NOW, opts)).toEqual({ step: 'lookup', reference: 'payout-BK-abc-lzx1' });
    // A claim still in progress is left alone either way.
    expect(nextServicePayoutStep(state({ payoutStatus: 'processing', payoutReference: 'payout-BK-abc-lzx1', claimedAt: iso(-60_000), attempts: 2 }), NOW, opts)).toMatchObject({ step: 'wait' });
    // The stable reference is never escalated for retries alone.
    expect(nextServicePayoutStep(state({ payoutStatus: 'processing', payoutReference: servicePayoutReference(BOOKING_ID), claimedAt: iso(-48 * H), attempts: 2 }), NOW, opts)).toMatchObject({ step: 'lookup' });
  });

  it('stops after the attempt limit and when already paid', () => {
    expect(nextServicePayoutStep(state({ payoutStatus: 'failed', payoutReference: stable, attempts: 3 }), NOW, opts)).toMatchObject({ step: 'escalate' });
    expect(nextServicePayoutStep(state({ payoutStatus: 'paid', payoutReference: stable }), NOW, opts)).toEqual({ step: 'done' });
  });

  it('acts on what the provider says, and only "not found" leads to a send (same stable reference)', () => {
    expect(afterServicePayoutLookup({ ok: true, value: null }, BOOKING_ID)).toEqual({ then: 'send', reference: stable });
    expect(afterServicePayoutLookup({ ok: true, value: { transferCode: 'TRF_1', status: 'success', amountCents: 1 } }, BOOKING_ID)).toEqual({ then: 'mark_paid' });
    expect(afterServicePayoutLookup({ ok: true, value: { transferCode: 'TRF_1', status: 'pending', amountCents: 1 } }, BOOKING_ID)).toEqual({ then: 'mark_in_flight' });
    for (const s of ['failed', 'reversed', 'rejected', 'blocked', 'abandoned', 'otp']) {
      expect(afterServicePayoutLookup({ ok: true, value: { transferCode: 'TRF_1', status: s, amountCents: 1 } }, BOOKING_ID)).toMatchObject({ then: 'escalate' });
    }
    expect(afterServicePayoutLookup({ ok: false, kind: 'unknown', message: 'timeout' }, BOOKING_ID)).toMatchObject({ then: 'wait' });
    expect(afterServicePayoutLookup({ ok: false, kind: 'rejected', message: 'Invalid key' }, BOOKING_ID)).toMatchObject({ then: 'wait' });
  });
});
