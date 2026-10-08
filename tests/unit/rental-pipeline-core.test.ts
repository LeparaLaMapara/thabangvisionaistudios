import { describe, it, expect, beforeEach } from 'vitest';
import { checkTransition, blocksInventory, allowedFromStatuses, EXPOSURE_STATUSES } from '@/lib/core/rental/state';
import { assessTrust, checkEligibility, collectionReasons, type RenterFacts } from '@/lib/core/rental/trust';
import * as L from '@/lib/core/rental/ledger';
import { applyProviderRefundStatus, nextRefundAction, planDepositRefund, refundableRemainder, mapProviderRefundStatus } from '@/lib/core/rental/refunds';
import { applyProviderTransferStatus, approveTransferRequest, checkPayoutEligibility, payoutReference } from '@/lib/core/rental/payouts';
import { decideCharge, eventDedupeKey, type PaymentIntent, type ChargeEvent } from '@/lib/core/rental/payments';
import { dueEscalations, returnDueAt, restrictsNewBookings } from '@/lib/core/rental/overdue';
import { buildNotices, collectionReminderAt, sastDate } from '@/lib/core/rental/notifications';
import { quoteRental } from '@/lib/core/pricing/rental';
import { processChargeEvent, processRefundEvent, submitRefund, processTransferEvent, submitPayout } from '@/lib/core/rental/use-cases';
import { RENTAL_POLICY } from '@/lib/constants';
import { Books, FakeClock, FakePaymentProvider, FakePayouts, FakeRefunds, FakeRentalPayments, FakeTransferProvider } from './helpers/rental-fakes';

const NOW = new Date('2026-10-08T10:00:00.000Z');

// ── State machine ────────────────────────────────────────────────────────────

describe('booking state machine', () => {
  it('allows the main journey and nothing else', () => {
    expect(checkTransition('pending', 'confirmed', 'system').ok).toBe(true);
    expect(checkTransition('confirmed', 'active', 'staff').ok).toBe(true);
    expect(checkTransition('active', 'overdue', 'system').ok).toBe(true);
    expect(checkTransition('overdue', 'return_pending', 'staff').ok).toBe(true);
    expect(checkTransition('return_pending', 'completed', 'staff').ok).toBe(true);

    expect(checkTransition('pending', 'active', 'staff')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(checkTransition('completed', 'pending', 'staff')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(checkTransition('cancelled', 'confirmed', 'system')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(checkTransition('bogus', 'confirmed', 'system')).toMatchObject({ ok: false, code: 'unknown_status' });
  });

  it('T08: a customer (browser) can never confirm a booking', () => {
    expect(checkTransition('pending', 'confirmed', 'customer')).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(allowedFromStatuses('confirmed', 'customer')).toEqual([]);
  });

  it('only a person closes a dispute, with a reason', () => {
    expect(checkTransition('disputed', 'completed', 'system')).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(checkTransition('disputed', 'completed', 'staff')).toMatchObject({ ok: false, code: 'reason_required' });
    expect(checkTransition('disputed', 'completed', 'staff', 'Repair quote agreed')).toMatchObject({ ok: true });
  });

  it('T06: repeating a transition that already happened is reported, not repeated', () => {
    expect(checkTransition('confirmed', 'confirmed', 'system')).toEqual({ ok: true, alreadyDone: true });
  });

  it('T24/T25: disputed, overdue and under-inspection gear stays off sale; expired holds do not', () => {
    const legacy = 30;
    for (const status of ['disputed', 'overdue', 'return_pending', 'return_reviewed', 'active', 'confirmed']) {
      expect(blocksInventory({ status }, NOW, legacy)).toBe(true);
    }
    expect(blocksInventory({ status: 'pending', hold_expires_at: '2026-10-08T10:05:00Z' }, NOW, legacy)).toBe(true);
    expect(blocksInventory({ status: 'pending', hold_expires_at: '2026-10-08T09:59:00Z' }, NOW, legacy)).toBe(false);
    expect(blocksInventory({ status: 'completed' }, NOW, legacy)).toBe(false);
    expect(blocksInventory({ status: 'cancelled' }, NOW, legacy)).toBe(false);
    expect(blocksInventory({ status: 'something_new' }, NOW, legacy)).toBe(true); // fail closed
    expect(EXPOSURE_STATUSES).toContain('disputed');
  });
});

// ── Trust tiers ──────────────────────────────────────────────────────────────

const base: RenterFacts = {
  emailVerified: true,
  phoneVerified: true,
  identityApproved: false,
  bankValidated: false,
  cleanReturns: 0,
  cleanReturnValueCents: 0,
  firstCleanReturnAt: null,
  openDisputes: 0,
  overdueNow: 0,
  overdueEscalated: 0,
  recentLateReturns: 0,
  fraudFlags: 0,
  suspended: false,
  manualReview: false,
};
const policy = { highValueCollectionThresholdCents: RENTAL_POLICY.highValueCollectionThresholdCents, firstHireCollectionOnly: true };

describe('trust tiers (server-calculated)', () => {
  it('climbs Contactable R2k → Verified R10k → Proven R25k → Trusted R80k', () => {
    expect(assessTrust({ ...base, phoneVerified: false }, NOW).tier.id).toBe('none');
    expect(assessTrust(base, NOW).tier).toMatchObject({ id: 'contactable', maxExposureCents: 200_000 });
    const verified = { ...base, identityApproved: true, bankValidated: true };
    expect(assessTrust(verified, NOW).tier).toMatchObject({ id: 'verified', maxExposureCents: 1_000_000 });
    const proven = { ...verified, cleanReturns: 1, cleanReturnValueCents: 1_000_000, firstCleanReturnAt: '2026-09-20T00:00:00Z' };
    expect(assessTrust(proven, NOW).tier).toMatchObject({ id: 'proven', maxExposureCents: 2_500_000 });
    // 14 days not yet elapsed → still Verified
    expect(assessTrust({ ...proven, firstCleanReturnAt: '2026-10-01T00:00:00Z' }, NOW).tier.id).toBe('verified');
    const trusted = { ...proven, cleanReturns: 5, cleanReturnValueCents: 5_000_000, firstCleanReturnAt: '2026-06-01T00:00:00Z' };
    expect(assessTrust(trusted, NOW).tier).toMatchObject({ id: 'trusted', maxExposureCents: 8_000_000 });
  });

  it('enforces the limit on everything held at once, not just the new order', () => {
    const verified = { ...base, identityApproved: true, bankValidated: true };
    const ok = checkEligibility({ facts: verified, currentExposureCents: 0, lines: [{ unitReplacementValueCents: 900_000, quantity: 1 }], delivery: false, policy, now: NOW });
    expect(ok.ok).toBe(true);
    const over = checkEligibility({ facts: verified, currentExposureCents: 500_000, lines: [{ unitReplacementValueCents: 600_000, quantity: 1 }], delivery: false, policy, now: NOW });
    expect(over).toMatchObject({ ok: false, code: 'trust_limit', exposureCents: 1_100_000 });
  });

  it('gear overdue past formal escalation, or a suspension, stops new bookings; lesser risks route to a person', () => {
    const verified = { ...base, identityApproved: true, bankValidated: true };
    expect(checkEligibility({ facts: { ...verified, overdueNow: 1, overdueEscalated: 1 }, currentExposureCents: 0, lines: [], delivery: false, policy, now: NOW })).toMatchObject({ ok: false, code: 'account_hold' });
    expect(checkEligibility({ facts: { ...verified, suspended: true }, currentExposureCents: 0, lines: [], delivery: false, policy, now: NOW })).toMatchObject({ ok: false, code: 'account_hold' });
    const late = checkEligibility({ facts: { ...verified, overdueNow: 1 }, currentExposureCents: 0, lines: [{ unitReplacementValueCents: 100_000, quantity: 1 }], delivery: false, policy, now: NOW });
    expect(late).toMatchObject({ ok: true, requiresManualApproval: true });
    const disputed = checkEligibility({ facts: { ...verified, openDisputes: 1 }, currentExposureCents: 0, lines: [{ unitReplacementValueCents: 100_000, quantity: 1 }], delivery: false, policy, now: NOW });
    expect(disputed).toMatchObject({ ok: true, requiresManualApproval: true });
  });

  it('T26: first hire and any item over R50,000 must be collected in person', () => {
    expect(collectionReasons({ cleanReturns: 0 }, [], policy)).toEqual(['first_hire']);
    expect(collectionReasons({ cleanReturns: 3 }, [{ unitReplacementValueCents: 5_000_001, quantity: 1 }], policy)).toEqual(['high_value_item']);
    expect(collectionReasons({ cleanReturns: 3 }, [{ unitReplacementValueCents: 5_000_000, quantity: 1 }], policy)).toEqual([]);
    const trusted: RenterFacts = { ...base, identityApproved: true, bankValidated: true, cleanReturns: 5, cleanReturnValueCents: 6_000_000, firstCleanReturnAt: '2026-01-01T00:00:00Z' };
    const r = checkEligibility({ facts: trusted, currentExposureCents: 0, lines: [{ unitReplacementValueCents: 6_000_000, quantity: 1 }], delivery: true, policy, now: NOW });
    expect(r).toMatchObject({ ok: false, code: 'collection_only' });
  });
});

// ── Ledger ───────────────────────────────────────────────────────────────────

describe('ledger', () => {
  it('rejects an unbalanced journal', () => {
    expect(() => L.assertBalanced({ lines: [{ account: 'cash_at_provider', debitCents: 100, creditCents: 0 }, { account: 'unearned_hire', debitCents: 0, creditCents: 99 }] })).toThrow();
  });

  it('T30: the spec worked example closes to zero on every liability (community gear)', () => {
    // R1,500 × 3 days, replacement R10,000 → hire R4,500, deposit R2,500, customer pays R7,000
    const q = quoteRental({ dailyRateCents: 150_000, days: 3, replacementValueCents: 1_000_000 });
    expect(q).toMatchObject({ hireCents: 450_000, depositCents: 250_000, totalCents: 700_000, ownerShareCents: 360_000, platformShareCents: 90_000 });
    const g = 'grp1';
    const js = [
      L.paymentCaptured({ bookingGroupId: g, providerReference: 'tx1', hireCents: q.hireCents, depositCents: q.depositCents }),
      L.providerFee({ providerReference: 'tx1', bookingGroupId: g, feeCents: 10_500 }),
      L.hireEarned({ bookingId: 'b1', bookingGroupId: g, hireCents: q.hireCents, ownership: 'community', ownerShareCents: q.ownerShareCents, platformShareCents: q.platformShareCents }),
      L.depositSettled({ bookingId: 'b1', bookingGroupId: g, depositCents: q.depositCents, damageCents: 0, lateFeeCents: 0 }),
      L.refundProcessed({ refundId: 'r1', bookingGroupId: g, amountCents: 250_000 }),
      L.payoutCompleted({ payoutId: 'p1', bookingGroupId: g, amountCents: 360_000 }),
    ];
    expect(L.reconcileClosedGroup({ journals: js, providerNetCents: 700_000 - 10_500 - 250_000 - 360_000 })).toEqual([]);
    const b = L.balances(js);
    expect(-b.platform_commission).toBe(90_000); // only the platform share is revenue
    expect(b.rental_revenue).toBe(0);
    expect(b.provider_fees).toBe(10_500); // fees are an expense, not taken from the owner
  });

  it('flags a deposit still held, a refund still owed, and an owner still unpaid', () => {
    const js = [
      L.paymentCaptured({ bookingGroupId: 'g', providerReference: 'tx', hireCents: 1000, depositCents: 500 }),
      L.hireEarned({ bookingId: 'b', bookingGroupId: 'g', hireCents: 1000, ownership: 'community', ownerShareCents: 800, platformShareCents: 200 }),
    ];
    const codes = L.reconcileClosedGroup({ journals: js }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['deposit_still_held', 'owner_still_owed']));
  });

  it('a deposit can never be treated as revenue, and deductions cannot exceed it', () => {
    expect(() => L.depositSettled({ bookingId: 'b', bookingGroupId: 'g', depositCents: 100, damageCents: 80, lateFeeCents: 30 })).toThrow();
    const j = L.paymentCaptured({ bookingGroupId: 'g', providerReference: 'tx', hireCents: 0, depositCents: 500 });
    expect(j.lines.find((l) => l.account === 'customer_deposits')?.creditCents).toBe(500);
  });
});

// ── Refund rules ─────────────────────────────────────────────────────────────

describe('refund rules', () => {
  it('T14: a refund never exceeds what remains of the charge', () => {
    expect(refundableRemainder({ chargedCents: 700_000, refundedOrInFlightCents: 450_000 })).toBe(250_000);
    expect(refundableRemainder({ chargedCents: 100, refundedOrInFlightCents: 200 })).toBe(0);
    const plan = planDepositRefund({ depositCents: 250_000, inspection: 'clean', disputed: false, damageCents: 0, damageEvidenceCount: 0, lateFeeCents: 0, refundableRemainderCents: 100_000 });
    expect(plan).toMatchObject({ ok: false, code: 'exceeds_charge' });
  });

  it('settles only after inspection, never without evidence, never by confiscation', () => {
    const args = { depositCents: 250_000, disputed: false, damageCents: 0, damageEvidenceCount: 0, lateFeeCents: 0, refundableRemainderCents: 700_000 };
    expect(planDepositRefund({ ...args, inspection: null })).toMatchObject({ ok: false, code: 'inspection_required' });
    expect(planDepositRefund({ ...args, inspection: 'damage', damageCents: 50_000 })).toMatchObject({ ok: false, code: 'unsupported_deduction' });
    expect(planDepositRefund({ ...args, inspection: 'damage', damageCents: 50_000, damageEvidenceCount: 2, lateFeeCents: 15_000 })).toMatchObject({ ok: true, refundCents: 185_000 });
    expect(planDepositRefund({ ...args, inspection: 'not_returned' })).toMatchObject({ ok: false, code: 'disputed' });
    expect(planDepositRefund({ ...args, inspection: 'clean', disputed: true })).toMatchObject({ ok: false, code: 'disputed' });
    expect(planDepositRefund({ ...args, inspection: 'clean' })).toMatchObject({ ok: true, refundCents: 250_000 });
  });

  it('provider statuses only move forward; repeats are duplicates', () => {
    expect(mapProviderRefundStatus('needs-attention')).toBe('needs_attention');
    expect(applyProviderRefundStatus('processed', 'processed')).toEqual({ apply: false, reason: 'duplicate' });
    expect(applyProviderRefundStatus('processed', 'pending')).toEqual({ apply: false, reason: 'terminal' });
    expect(applyProviderRefundStatus('processing', 'pending')).toEqual({ apply: false, reason: 'stale' });
    expect(applyProviderRefundStatus('pending', 'processed')).toMatchObject({ apply: true, to: 'processed', notifyCustomer: 'processed' });
    expect(applyProviderRefundStatus('pending', 'failed')).toMatchObject({ apply: true, alertStaff: true, notifyCustomer: 'failed' });
  });

  it('an uncertain earlier attempt is reconciled before any retry', () => {
    const o = { state: 'claimed' as const, amountCents: 1, providerRefundId: null, claimedAt: '2026-10-08T09:00:00Z', attempts: 1 };
    expect(nextRefundAction(o, NOW)).toEqual({ action: 'reconcile_first' });
    expect(nextRefundAction({ ...o, claimedAt: '2026-10-08T09:58:00Z' }, NOW)).toEqual({ action: 'wait' });
    expect(nextRefundAction({ ...o, state: 'requested' }, NOW)).toEqual({ action: 'reconcile_first' });
  });
});

// ── Payout rules ─────────────────────────────────────────────────────────────

describe('payout rules', () => {
  const facts = {
    ownerVerified: true,
    payoutRecipientValidated: true,
    bookingStatus: 'completed',
    rentalPaymentConfirmed: true,
    inspectionCompleted: true,
    openPayoutBlockingDisputes: 0,
    depositSettled: true,
    payoutAlreadyStarted: false,
    completedAt: '2026-10-06T09:00:00Z',
  };
  it('pays 48h after a clean completion, and lists every unmet condition', () => {
    expect(checkPayoutEligibility(facts, NOW, 48)).toMatchObject({ eligible: true });
    const early = checkPayoutEligibility({ ...facts, completedAt: '2026-10-07T09:00:00Z' }, NOW, 48);
    expect(early).toMatchObject({ eligible: false, reasons: ['delay_not_elapsed'] });
    const bad = checkPayoutEligibility({ ...facts, ownerVerified: false, openPayoutBlockingDisputes: 1, payoutAlreadyStarted: true }, NOW, 48);
    expect(bad.eligible ? [] : bad.reasons).toEqual(expect.arrayContaining(['owner_not_verified', 'open_dispute', 'payout_already_started']));
  });

  it('approves only a transfer that matches our instruction exactly', () => {
    const ins = { reference: payoutReference('9b2f1c3e-0000-4000-8000-000000000001'), amountCents: 360_000, recipientCode: 'RCP_1', state: 'claimed' as const };
    expect(approveTransferRequest({ reference: ins.reference, amountCents: 360_000, recipientCode: 'RCP_1', currency: 'ZAR' }, ins).approve).toBe(true);
    expect(approveTransferRequest({ reference: ins.reference, amountCents: 360_001, recipientCode: 'RCP_1', currency: 'ZAR' }, ins).reason).toBe('amount_mismatch');
    expect(approveTransferRequest({ reference: ins.reference, amountCents: 360_000, recipientCode: 'RCP_X', currency: 'ZAR' }, ins).reason).toBe('recipient_mismatch');
    expect(approveTransferRequest({ reference: 'x', amountCents: 1, recipientCode: 'RCP_1', currency: 'ZAR' }, null).reason).toBe('unknown_reference');
    expect(approveTransferRequest({ reference: ins.reference, amountCents: 360_000, recipientCode: 'RCP_1', currency: 'ZAR' }, { ...ins, state: 'success' }).approve).toBe(false);
  });

  it('success is final unless reversed; a late failure after success is ignored', () => {
    expect(applyProviderTransferStatus('success', 'failed')).toEqual({ apply: false, reason: 'stale' });
    expect(applyProviderTransferStatus('success', 'success')).toEqual({ apply: false, reason: 'duplicate' });
    expect(applyProviderTransferStatus('success', 'reversed')).toMatchObject({ apply: true, ledger: 'reversed', alertStaff: true });
    expect(applyProviderTransferStatus('pending', 'success')).toMatchObject({ apply: true, ledger: 'completed' });
  });
});

// ── Charge decisions (the 12 webhook scenarios) ──────────────────────────────

describe('charge decisions', () => {
  const intent: PaymentIntent = { reference: 'grp', state: 'initiated', expectedAmountCents: 700_000, currency: 'ZAR', userId: 'u1', providerTransactionId: null, holdExpiresAt: '2026-10-08T10:30:00Z' };
  const ok: ChargeEvent = { kind: 'charge.success', reference: 'grp', providerTransactionId: 't1', amountCents: 700_000, currency: 'ZAR', metadataUserId: 'u1' };
  const pending = { statuses: { pending: 2 }, cancelledByExpiry: 0 };

  it('confirms an exact, live payment', () => expect(decideCharge(intent, ok, pending, NOW)).toEqual({ action: 'confirm' }));
  it('#9 wrong amount never confirms', () => expect(decideCharge(intent, { ...ok, amountCents: 1 }, pending, NOW)).toMatchObject({ action: 'hold_mismatch', why: 'amount' }));
  it('#10 wrong currency or reference never confirms', () => {
    expect(decideCharge(intent, { ...ok, currency: 'NGN' }, pending, NOW)).toMatchObject({ action: 'hold_mismatch', why: 'currency' });
    expect(decideCharge(intent, { ...ok, reference: 'other' }, pending, NOW)).toEqual({ action: 'unknown_reference' });
    expect(decideCharge(null, ok, pending, NOW)).toEqual({ action: 'unknown_reference' });
  });
  it('wrong customer never confirms', () => expect(decideCharge(intent, { ...ok, metadataUserId: 'u2' }, pending, NOW)).toMatchObject({ action: 'hold_mismatch', why: 'customer' }));
  it('#1 the same transaction twice is a duplicate', () => expect(decideCharge({ ...intent, state: 'paid', providerTransactionId: 't1' }, ok, { statuses: { confirmed: 2 }, cancelledByExpiry: 0 }, NOW)).toEqual({ action: 'duplicate' }));
  it('#4/T12 a failure after payment is ignored', () => expect(decideCharge({ ...intent, state: 'paid', providerTransactionId: 't1' }, { ...ok, kind: 'charge.failed' }, pending, NOW)).toMatchObject({ action: 'ignore' }));
  it('#3/T11 paid after the hold expired → re-reserve under lock', () => {
    expect(decideCharge(intent, ok, pending, new Date('2026-10-08T11:00:00Z'))).toEqual({ action: 'confirm_late' });
    expect(decideCharge(intent, ok, { statuses: { cancelled: 2 }, cancelledByExpiry: 2 }, NOW)).toEqual({ action: 'confirm_late' });
  });
  it('a card payment for an order already confirmed another way (e.g. Mark paid) is held for a person', () => {
    expect(decideCharge(intent, ok, { statuses: { confirmed: 2 }, cancelledByExpiry: 0 }, NOW)).toMatchObject({ action: 'hold_mismatch' });
  });
  it('#11 paid for a booking a person cancelled → refund', () => expect(decideCharge(intent, ok, { statuses: { cancelled: 2 }, cancelledByExpiry: 0 }, NOW)).toMatchObject({ action: 'refund_paid_cancelled', refundCents: 700_000 }));
  it('dedupe keys separate redelivery from a real status change', () => {
    expect(eventDedupeKey('paystack', 'refund.processed', 55, 'processed')).toBe(eventDedupeKey('paystack', 'refund.processed', 55, 'processed'));
    expect(eventDedupeKey('paystack', 'refund.pending', 55, 'pending')).not.toBe(eventDedupeKey('paystack', 'refund.processed', 55, 'processed'));
  });
});

// ── Overdue and notifications ────────────────────────────────────────────────

describe('overdue ladder and notifications', () => {
  it('escalates to people at +2h, +24h, +48h and +96h, once each', () => {
    const due = returnDueAt('2026-10-07'); // end of 7 Oct SAST
    expect(due.toISOString()).toBe('2026-10-07T22:00:00.000Z');
    expect(dueEscalations(due, new Date('2026-10-07T23:00:00Z'), [])).toEqual([]);
    expect(dueEscalations(due, new Date('2026-10-08T00:30:00Z'), [])).toEqual(['reminder']);
    expect(dueEscalations(due, new Date('2026-10-10T00:00:00Z'), ['reminder'])).toEqual(['phone_follow_up', 'formal_escalation']);
    expect(restrictsNewBookings(['reminder'])).toBe(false);
    expect(restrictsNewBookings(['reminder', 'phone_follow_up', 'formal_escalation'])).toBe(true);
  });

  it('collection reminders go out at 07:45 SAST', () => {
    expect(collectionReminderAt('2026-10-09').toISOString()).toBe('2026-10-09T05:45:00.000Z');
    expect(sastDate(new Date('2026-10-08T22:30:00Z'))).toBe('2026-10-09');
  });

  it('builds one dedupe key per channel and occurrence', () => {
    const a = buildNotices({ kind: 'refund_processed', userId: 'u', bookingIds: ['b'], discriminator: 'rf1' });
    const b = buildNotices({ kind: 'refund_processed', userId: 'u', bookingIds: ['b'], discriminator: 'rf1' });
    expect(a.map((n) => n.dedupeKey)).toEqual(b.map((n) => n.dedupeKey));
    expect(new Set(a.map((n) => n.channel))).toEqual(new Set(['in_app', 'email']));
  });
});

// ── Use cases against in-memory adapters ─────────────────────────────────────

describe('payment, refund and payout use cases (in-memory adapters, not live)', () => {
  let clock: FakeClock;
  let books: Books;
  let refunds: FakeRefunds;
  let repo: FakeRentalPayments;
  const event: ChargeEvent = { kind: 'charge.success', reference: 'grp1', providerTransactionId: 'tx1', amountCents: 700_000, currency: 'ZAR', metadataUserId: 'u1' };

  beforeEach(() => {
    clock = new FakeClock(NOW);
    books = new Books();
    refunds = new FakeRefunds(books, clock);
    repo = new FakeRentalPayments(books, refunds);
    repo.intents.set('grp1', {
      reference: 'grp1',
      checkoutGroupId: 'grp1',
      state: 'initiated',
      userId: 'u1',
      expectedAmountCents: 700_000,
      hireCents: 450_000,
      depositCents: 250_000,
      deliveryCents: 0,
      currency: 'ZAR',
      providerTransactionId: null,
      holdExpiresAt: '2026-10-08T10:30:00Z',
      bookingIds: ['b1'],
    });
    repo.lines.set('grp1', [{ id: 'b1', status: 'pending', cancelReason: null, units: 1, rentalId: 'cam' }]);
    repo.stock.set('cam', 1);
  });

  it('T08: without a verified event nothing is confirmed', () => {
    expect(repo.lines.get('grp1')![0].status).toBe('pending');
    expect(books.journals.size).toBe(0);
  });

  it('T09: a duplicate paid webhook confirms once, books once, notifies once (T28)', async () => {
    expect(await processChargeEvent(event, { repo, clock })).toBe('confirmed');
    const outboxAfterFirst = books.outbox.size;
    expect(await processChargeEvent(event, { repo, clock })).toBe('duplicate');
    expect(books.journals.size).toBe(1);
    expect(books.outbox.size).toBe(outboxAfterFirst);
    expect(repo.lines.get('grp1')![0].status).toBe('confirmed');
  });

  it('T12: a failed event after payment cannot cancel the paid booking', async () => {
    await processChargeEvent(event, { repo, clock });
    expect(await processChargeEvent({ ...event, kind: 'charge.failed', providerTransactionId: 'tx2' }, { repo, clock })).toBe('ignored');
    expect(repo.lines.get('grp1')![0].status).toBe('confirmed');
  });

  it('#2 out of order: failed attempt then success still confirms', async () => {
    expect(await processChargeEvent({ ...event, kind: 'charge.failed', providerTransactionId: 'tx0' }, { repo, clock })).toBe('failure_recorded');
    expect(await processChargeEvent(event, { repo, clock })).toBe('confirmed');
  });

  it('T11: late payment with stock still free is reinstated', async () => {
    repo.lines.set('grp1', [{ id: 'b1', status: 'cancelled', cancelReason: 'hold_expired', units: 1, rentalId: 'cam' }]);
    clock.advanceMinutes(120);
    expect(await processChargeEvent(event, { repo, clock })).toBe('confirmed_late');
  });

  it('T11: late payment after the stock was sold elsewhere is refunded, never double-booked', async () => {
    repo.lines.set('grp1', [{ id: 'b1', status: 'cancelled', cancelReason: 'hold_expired', units: 1, rentalId: 'cam' }]);
    repo.takenElsewhere.set('cam', 1);
    clock.advanceMinutes(120);
    expect(await processChargeEvent(event, { repo, clock })).toBe('late_unavailable_refund_due');
    expect(repo.lines.get('grp1')![0].status).toBe('cancelled');
    const obligations = [...refunds.rows.values()];
    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({ amountCents: 700_000, reason: 'late_payment', state: 'eligible' });
    // replay → no second obligation
    expect(await processChargeEvent(event, { repo, clock })).toBe('duplicate');
    expect(refunds.rows.size).toBe(1);
  });

  it('#9 wrong amount is held for a person, not confirmed and not auto-refunded', async () => {
    expect(await processChargeEvent({ ...event, amountCents: 1000 }, { repo, clock })).toBe('mismatch_held');
    expect(repo.lines.get('grp1')![0].status).toBe('pending');
    expect(refunds.rows.size).toBe(0);
    expect([...books.outbox.values()].some((n) => n.kind === 'staff_alert')).toBe(true);
  });

  it('a second payment after a manual confirmation is held, not booked as revenue', async () => {
    repo.lines.get('grp1')![0].status = 'confirmed';
    expect(await processChargeEvent(event, { repo, clock })).toBe('mismatch_held');
    expect([...books.journals.values()].map((j) => j.kind)).toEqual(['unallocated_receipt']);
    expect(refunds.rows.size).toBe(0);
  });

  it('#6/T29: a database failure leaves a retryable state; the retry confirms once', async () => {
    repo.failNextConfirm = true;
    await expect(processChargeEvent(event, { repo, clock })).rejects.toThrow();
    expect(repo.lines.get('grp1')![0].status).toBe('pending');
    expect(await processChargeEvent(event, { repo, clock })).toBe('confirmed');
    expect(books.journals.size).toBe(1);
  });

  it('T13: a refund that timed out is reconciled, never sent twice', async () => {
    const provider = new FakePaymentProvider();
    const r = refunds.create({ obligationKey: 'refund:deposit_settlement:b1', reason: 'deposit_settlement', amountCents: 250_000, transactionReference: 'tx1', userId: 'u1', bookingGroupId: 'grp1', bookingIds: ['b1'], fromUnallocated: false, chargedCents: 700_000 })!;
    provider.mode = 'timeout_after_send';
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('unknown_outcome');
    expect((await refunds.get(r.id))!.state).toBe('claimed');
    // an impatient second worker straight away: waits
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('waiting');
    clock.advanceMinutes(15);
    provider.mode = 'ok';
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('reconciled');
    expect(provider.calls).toHaveLength(1);
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('waiting');
    expect(provider.calls).toHaveLength(1);
  });

  it('T13: the same obligation cannot be created twice; T14: refunds cannot exceed the charge', () => {
    const args = { reason: 'deposit_settlement' as const, transactionReference: 'tx9', userId: 'u1', bookingGroupId: 'g', bookingIds: ['b'], fromUnallocated: false };
    expect(refunds.create({ ...args, obligationKey: 'k1', amountCents: 400, chargedCents: 500 })).not.toBeNull();
    expect(refunds.create({ ...args, obligationKey: 'k1', amountCents: 400 })).toBeNull();
    expect(() => refunds.create({ ...args, obligationKey: 'k2', amountCents: 200 })).toThrow(/exceed/);
  });

  it('T15: a rejected or failed refund raises a staff alert and tells the customer', async () => {
    const provider = new FakePaymentProvider();
    provider.mode = 'reject';
    const r = refunds.create({ obligationKey: 'k', reason: 'cancellation', amountCents: 100, transactionReference: 'tx1', userId: 'u1', bookingGroupId: 'grp1', bookingIds: ['b1'], fromUnallocated: false })!;
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('escalated');
    expect((await refunds.get(r.id))!.state).toBe('failed');
    const kinds = [...books.outbox.values()].map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['staff_alert', 'refund_failed']));
  });

  it('#5: refund completion delivered twice is applied once', async () => {
    const provider = new FakePaymentProvider();
    const r = refunds.create({ obligationKey: 'k', reason: 'cancellation', amountCents: 100, transactionReference: 'tx1', userId: 'u1', bookingGroupId: 'grp1', bookingIds: ['b1'], fromUnallocated: false })!;
    await submitRefund(r.id, { refunds, payments: provider, clock });
    const prf = (await refunds.get(r.id))!.providerRefundId;
    const ev = { providerRefundId: prf, transactionReference: 'tx1', amountCents: 100, status: 'processed' };
    expect(await processRefundEvent(ev, { refunds })).toBe('applied');
    expect(await processRefundEvent(ev, { refunds })).toBe('duplicate');
    expect(await processRefundEvent({ ...ev, status: 'pending' }, { refunds })).toBe('stale');
    expect([...books.journals.keys()].filter((k) => k.startsWith('refund:'))).toHaveLength(1);
  });

  it('T16/#12: transfer retries and late responses cannot pay an owner twice; T17 reversal is booked back', async () => {
    const payouts = new FakePayouts(books, clock);
    const transfers = new FakeTransferProvider();
    const ref = payoutReference('9b2f1c3e-0000-4000-8000-000000000002');
    payouts.rows.set('po1', { id: 'po1', bookingId: 'b1', ownerId: 'o1', state: 'approved', amountCents: 360_000, transferReference: ref, recipientCode: 'RCP_1', providerTransferCode: null, claimedAt: null, bookingGroupId: 'grp1' });

    transfers.mode = 'timeout_after_send';
    expect(await submitPayout('po1', { payouts, transfers, clock })).toBe('unknown_outcome');
    expect(await submitPayout('po1', { payouts, transfers, clock })).toBe('waiting');
    clock.advanceMinutes(15);
    transfers.mode = 'ok';
    expect(await submitPayout('po1', { payouts, transfers, clock })).toBe('reconciled');
    expect(transfers.moneyMoved).toBe(360_000);

    expect(await processTransferEvent({ reference: ref, status: 'success', transferCode: 'TRF' }, { payouts })).toBe('applied');
    expect(await processTransferEvent({ reference: ref, status: 'success', transferCode: 'TRF' }, { payouts })).toBe('duplicate');
    expect(await processTransferEvent({ reference: ref, status: 'failed', transferCode: 'TRF' }, { payouts })).toBe('stale');
    expect(transfers.moneyMoved).toBe(360_000);
    expect(books.journals.has('payout:po1')).toBe(true);

    expect(await processTransferEvent({ reference: ref, status: 'reversed', transferCode: 'TRF' }, { payouts })).toBe('applied');
    const b = L.balances([...books.journals.values()].filter((j) => j.kind.startsWith('payout')));
    expect(b.owner_payable).toBe(0); // paid then reversed: the payable is back where it was
    expect([...books.outbox.values()].some((n) => n.kind === 'staff_alert' && String(n.data.what).includes('reversed'))).toBe(true);
  });

  it('T29: a provider outage leaves every obligation recoverable', async () => {
    const provider = new FakePaymentProvider();
    provider.mode = 'down';
    const r = refunds.create({ obligationKey: 'k', reason: 'cancellation', amountCents: 100, transactionReference: 'tx1', userId: 'u1', bookingGroupId: 'grp1', bookingIds: ['b1'], fromUnallocated: false })!;
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('unknown_outcome');
    clock.advanceMinutes(15);
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('unknown_outcome'); // still down: nothing moves
    provider.mode = 'ok';
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('reconciled'); // not found → released
    expect(await submitRefund(r.id, { refunds, payments: provider, clock })).toBe('submitted');
    expect(provider.calls).toHaveLength(1);
  });
});
