import { assertCents } from '@/lib/core/pricing/money';
import type { ShipmentLeg } from '@/lib/core/delivery/state';

/**
 * Append-only, double-entry ledger for gear hire (spec §4.3). Pure.
 *
 * Every money movement is a journal: two or more lines whose debits equal
 * their credits. Journals are never edited. A mistake is corrected with a
 * reversing journal.
 *
 * Key accounting choices:
 * - Money received is NOT revenue. The hire is `unearned_hire` (a liability)
 *   until the hire is completed. The deposit is `customer_deposits` (a
 *   liability) until it is settled.
 * - On completion, unearned hire becomes `rental_revenue` (studio gear), or is
 *   split into `owner_payable` + `platform_commission` (community gear).
 * - Processing fees are their own expense. They are never silently taken
 *   from owner earnings (spec §3.4).
 * - A refund first becomes `refunds_payable`, and only leaves `cash_at_provider`
 *   once the provider reports it processed.
 *   A submitted refund is not a completed refund.
 */

export const LEDGER_ACCOUNTS = {
  cash_at_provider: 'asset',
  unearned_hire: 'liability',
  customer_deposits: 'liability',
  refunds_payable: 'liability',
  owner_payable: 'liability',
  unallocated_receipts: 'liability',
  rental_revenue: 'revenue',
  platform_commission: 'revenue',
  delivery_income: 'revenue',
  damage_income: 'revenue',
  late_fee_income: 'revenue',
  cancellation_income: 'revenue',
  provider_fees: 'expense',
  chargebacks: 'expense',
  // Phase 4 (migration 076): what couriers charge us, and what we owe them
  // until their invoice is paid. Never mixed with the customer's delivery fee.
  courier_costs: 'expense',
  delivery_payable: 'liability',
} as const;

export type LedgerAccount = keyof typeof LEDGER_ACCOUNTS;

export interface LedgerLine {
  account: LedgerAccount;
  debitCents: number;
  creditCents: number;
}

export interface Journal {
  /** Stable key for the business event; the database keeps one journal per key. */
  idempotencyKey: string;
  kind: JournalKind;
  bookingGroupId: string | null;
  memo: string;
  lines: LedgerLine[];
}

export type JournalKind =
  | 'payment_captured'
  | 'unallocated_receipt'
  | 'provider_fee'
  | 'hire_earned'
  | 'deposit_settled'
  | 'cancellation'
  | 'refund_processed'
  | 'refund_reversed'
  | 'payout_completed'
  | 'payout_reversed'
  | 'chargeback'
  | 'adjustment'
  | 'courier_cost'
  | 'delivery_cancelled';

const dr = (account: LedgerAccount, cents: number): LedgerLine => ({ account, debitCents: cents, creditCents: 0 });
const cr = (account: LedgerAccount, cents: number): LedgerLine => ({ account, debitCents: 0, creditCents: cents });

function journal(
  idempotencyKey: string,
  kind: JournalKind,
  bookingGroupId: string | null,
  memo: string,
  lines: LedgerLine[],
): Journal {
  const kept = lines.filter((l) => l.debitCents !== 0 || l.creditCents !== 0);
  const j: Journal = { idempotencyKey, kind, bookingGroupId, memo, lines: kept };
  assertBalanced(j);
  return j;
}

export function journalTotals(j: Pick<Journal, 'lines'>): { debits: number; credits: number } {
  let debits = 0;
  let credits = 0;
  for (const l of j.lines) {
    assertCents(l.debitCents, 'debitCents');
    assertCents(l.creditCents, 'creditCents');
    if (l.debitCents < 0 || l.creditCents < 0) throw new RangeError('ledger amounts are never negative');
    if (l.debitCents > 0 && l.creditCents > 0) throw new RangeError('a ledger line is a debit or a credit, not both');
    debits += l.debitCents;
    credits += l.creditCents;
  }
  return { debits, credits };
}

export function isBalanced(j: Pick<Journal, 'lines'>): boolean {
  const { debits, credits } = journalTotals(j);
  return debits === credits && j.lines.length >= 2;
}

export function assertBalanced(j: Pick<Journal, 'lines'>): void {
  if (!isBalanced(j)) {
    const { debits, credits } = journalTotals(j);
    throw new RangeError(`unbalanced journal: debits ${debits} ≠ credits ${credits}`);
  }
}

// ── Journals for each business event ────────────────────────────────────────

/** A verified payment for an order: hire, deposit and delivery fee. */
export function paymentCaptured(p: {
  bookingGroupId: string;
  providerReference: string;
  hireCents: number;
  depositCents: number;
  deliveryFeeCents?: number;
}): Journal {
  const delivery = p.deliveryFeeCents ?? 0;
  const total = p.hireCents + p.depositCents + delivery;
  return journal(`payment:${p.providerReference}`, 'payment_captured', p.bookingGroupId, 'Payment received for gear hire', [
    dr('cash_at_provider', total),
    cr('unearned_hire', p.hireCents),
    cr('customer_deposits', p.depositCents),
    // A delivery fee is earned when the delivery happens; until Phase 4 it is
    // collected with the hire and treated the same way.
    cr('unearned_hire', delivery),
  ]);
}

/**
 * Money that arrived but cannot be applied to a booking (wrong amount, paid
 * after expiry with no stock, cancelled booking). It is owed back, never
 * revenue.
 */
export function unallocatedReceipt(p: { providerReference: string; bookingGroupId: string | null; amountCents: number; reason: string }): Journal {
  return journal(`unallocated:${p.providerReference}`, 'unallocated_receipt', p.bookingGroupId, `Unallocated receipt: ${p.reason}`, [
    dr('cash_at_provider', p.amountCents),
    cr('unallocated_receipts', p.amountCents),
  ]);
}

export function providerFee(p: { providerReference: string; bookingGroupId: string | null; feeCents: number }): Journal {
  return journal(`fee:${p.providerReference}`, 'provider_fee', p.bookingGroupId, 'Payment provider processing fee', [
    dr('provider_fees', p.feeCents),
    cr('cash_at_provider', p.feeCents),
  ]);
}

/**
 * The hire was delivered: unearned hire becomes revenue. For community gear
 * the owner's share is a payable, never platform revenue.
 */
export function hireEarned(p: {
  bookingId: string;
  bookingGroupId: string;
  hireCents: number;
  ownership: 'studio' | 'community';
  ownerShareCents: number;
  platformShareCents: number;
  /** The order's delivery fee, on the one line that carries it: earned when the hire completes. */
  deliveryCents?: number;
}): Journal {
  if (p.ownership === 'community' && p.ownerShareCents + p.platformShareCents !== p.hireCents) {
    throw new RangeError('owner + platform share must equal the hire');
  }
  const credits =
    p.ownership === 'studio'
      ? [cr('rental_revenue', p.hireCents)]
      : [cr('owner_payable', p.ownerShareCents), cr('platform_commission', p.platformShareCents)];
  const delivery = p.deliveryCents ?? 0;
  return journal(`earned:${p.bookingId}`, 'hire_earned', p.bookingGroupId, 'Hire completed', [
    dr('unearned_hire', p.hireCents + delivery),
    ...credits,
    cr('delivery_income', delivery),
  ]);
}

/** Deposit settled after inspection: refund owed, documented deductions kept. */
export function depositSettled(p: {
  bookingId: string;
  bookingGroupId: string;
  depositCents: number;
  damageCents: number;
  lateFeeCents: number;
}): Journal {
  const kept = p.damageCents + p.lateFeeCents;
  if (kept > p.depositCents) throw new RangeError('deductions cannot exceed the deposit held');
  return journal(`deposit:${p.bookingId}`, 'deposit_settled', p.bookingGroupId, 'Deposit settled after inspection', [
    dr('customer_deposits', p.depositCents),
    cr('refunds_payable', p.depositCents - kept),
    cr('damage_income', p.damageCents),
    cr('late_fee_income', p.lateFeeCents),
  ]);
}

/** A paid booking cancelled before handover: the published tier decides how much hire is kept. */
export function cancellation(p: {
  bookingId: string;
  bookingGroupId: string;
  hireCents: number;
  hireRefundCents: number;
  depositCents: number;
}): Journal {
  if (p.hireRefundCents > p.hireCents) throw new RangeError('cannot refund more hire than was paid');
  return journal(`cancel:${p.bookingId}`, 'cancellation', p.bookingGroupId, 'Paid booking cancelled', [
    dr('unearned_hire', p.hireCents),
    dr('customer_deposits', p.depositCents),
    cr('refunds_payable', p.hireRefundCents + p.depositCents),
    cr('cancellation_income', p.hireCents - p.hireRefundCents),
  ]);
}

/** The provider says the refund reached the customer. */
export function refundProcessed(p: { refundId: string; bookingGroupId: string | null; amountCents: number; fromUnallocated?: boolean }): Journal {
  return journal(`refund:${p.refundId}`, 'refund_processed', p.bookingGroupId, 'Refund processed by provider', [
    dr(p.fromUnallocated ? 'unallocated_receipts' : 'refunds_payable', p.amountCents),
    cr('cash_at_provider', p.amountCents),
  ]);
}

export function payoutCompleted(p: { payoutId: string; bookingGroupId: string | null; amountCents: number }): Journal {
  return journal(`payout:${p.payoutId}`, 'payout_completed', p.bookingGroupId, 'Owner payout completed', [
    dr('owner_payable', p.amountCents),
    cr('cash_at_provider', p.amountCents),
  ]);
}

/** A completed transfer came back (reversed): the owner is owed it again. */
export function payoutReversed(p: { payoutId: string; bookingGroupId: string | null; amountCents: number }): Journal {
  return journal(`payout-reversed:${p.payoutId}`, 'payout_reversed', p.bookingGroupId, 'Owner payout reversed by provider', [
    dr('cash_at_provider', p.amountCents),
    cr('owner_payable', p.amountCents),
  ]);
}

export function chargeback(p: { providerReference: string; bookingGroupId: string | null; amountCents: number }): Journal {
  return journal(`chargeback:${p.providerReference}`, 'chargeback', p.bookingGroupId, 'Chargeback', [
    dr('chargebacks', p.amountCents),
    cr('cash_at_provider', p.amountCents),
  ]);
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/** Net balance per account, as debit minus credit (positive = debit balance). */
export function balances(journals: readonly Pick<Journal, 'lines'>[]): Record<LedgerAccount, number> {
  const out = Object.fromEntries(Object.keys(LEDGER_ACCOUNTS).map((a) => [a, 0])) as Record<LedgerAccount, number>;
  for (const j of journals) {
    for (const l of j.lines) out[l.account] += l.debitCents - l.creditCents;
  }
  return out;
}

export interface ReconciliationIssue {
  code:
    | 'unbalanced_journal'
    | 'deposit_still_held'
    | 'refund_still_owed'
    | 'hire_not_recognised'
    | 'owner_still_owed'
    | 'unallocated_money'
    | 'cash_mismatch';
  detail: string;
}

/**
 * Checks one financially closed booking group. Every liability it created
 * must be back to zero, and the cash the ledger says moved must match what
 * the provider reports.
 */
export function reconcileClosedGroup(params: {
  journals: readonly Journal[];
  /** Net cash per the provider: captured − refunded − paid out − fees. Omit when not fetched. */
  providerNetCents?: number;
}): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  for (const j of params.journals) {
    if (!isBalanced(j)) issues.push({ code: 'unbalanced_journal', detail: j.idempotencyKey });
  }
  const b = balances(params.journals);
  if (b.customer_deposits !== 0) issues.push({ code: 'deposit_still_held', detail: `${-b.customer_deposits} cents` });
  if (b.refunds_payable !== 0) issues.push({ code: 'refund_still_owed', detail: `${-b.refunds_payable} cents` });
  if (b.unearned_hire !== 0) issues.push({ code: 'hire_not_recognised', detail: `${-b.unearned_hire} cents` });
  if (b.owner_payable !== 0) issues.push({ code: 'owner_still_owed', detail: `${-b.owner_payable} cents` });
  if (b.unallocated_receipts !== 0) issues.push({ code: 'unallocated_money', detail: `${-b.unallocated_receipts} cents` });
  if (params.providerNetCents !== undefined && params.providerNetCents !== b.cash_at_provider) {
    issues.push({ code: 'cash_mismatch', detail: `ledger ${b.cash_at_provider} vs provider ${params.providerNetCents}` });
  }
  return issues;
}

/**
 * A delivery fee becomes income.
 *
 * With `leg` (Phase 4): one journal per order AND leg, keyed
 * `delivery:{group}:{leg}`, so the outbound and return legs are recognised
 * separately, each exactly once, when that leg is done (outbound: every item
 * accepted by the renter; return: received back).
 *
 * Without `leg` (the pre-Phase-4 own-vehicle fee, one fee per order covering
 * the round trip): the key stays `delivery:{group}`, exactly as before, so
 * orders already part-way through (one line earned under the old key) are
 * still recognised once. Mapping the legacy call to the outbound leg would
 * give those orders a second, differently keyed journal. The two forms are
 * for different money (a legacy order fee vs Phase-4 leg quotes) and an order
 * uses one or the other, never both.
 */
export function deliveryEarned(p: { bookingGroupId: string; deliveryCents: number; leg?: ShipmentLeg; attempt?: number; originOwnerId?: string | null }): Journal {
  // A later attempt of a leg (the first failed and was re-dispatched with its
  // own paid quote) earns under its own key, or the first attempt's journal
  // would swallow it. Attempt 1 keeps the plain leg key.
  const attempt = p.leg && p.attempt && p.attempt > 1 ? `:a${p.attempt}` : '';
  // Phase 8 (D-84): an order can have one leg per origin (our site, each
  // owner's pickup address). A leg from an owner's address carries
  // `@{ownerId}` after the leg name; a leg from our site carries nothing, so
  // every key made before Phase 8 (studio-only orders) is unchanged:
  //   delivery:{group}:{leg}[@{owner}][:a{n}]
  const origin = p.leg && p.originOwnerId ? `@${p.originOwnerId}` : '';
  const key = p.leg ? `delivery:${p.bookingGroupId}:${p.leg}${origin}${attempt}` : `delivery:${p.bookingGroupId}`;
  return journal(key, 'hire_earned', p.bookingGroupId, p.leg ? `Delivery fee earned (${p.leg} leg${origin ? ', from the owner' : ''})` : 'Delivery fee earned', [
    dr('unearned_hire', p.deliveryCents),
    cr('delivery_income', p.deliveryCents),
  ]);
}

/**
 * What a courier charges us for a shipment: an expense owed to the provider
 * until its invoice is paid. `what` separates legitimate repeats (the job,
 * a cancellation fee, an invoice adjustment). Own-fleet legs post none.
 */
export function courierCost(p: { shipmentId: string; bookingGroupId: string | null; amountCents: number; what: string }): Journal {
  return journal(`courier-cost:${p.shipmentId}:${p.what}`, 'courier_cost', p.bookingGroupId, `Courier cost (${p.what})`, [
    dr('courier_costs', p.amountCents),
    cr('delivery_payable', p.amountCents),
  ]);
}

/** The provider's invoice came in BELOW what we accrued: reduce the cost and the payable. */
export function courierCostReduction(p: { shipmentId: string; bookingGroupId: string | null; amountCents: number; what: string }): Journal {
  return journal(`courier-cost:${p.shipmentId}:${p.what}`, 'courier_cost', p.bookingGroupId, `Courier cost reduced (${p.what})`, [
    dr('delivery_payable', p.amountCents),
    cr('courier_costs', p.amountCents),
  ]);
}

/**
 * A paid delivery leg that will not happen (cancelled, or dispatch failed):
 * the customer's fee leaves unearned hire. What goes back becomes
 * refunds_payable; anything kept (a provider cancellation fee passed on at
 * cost, D-39) is delivery income. One journal per shipment.
 */
export function deliveryCancelled(p: { shipmentId: string; bookingGroupId: string; customerFeeCents: number; refundCents: number }): Journal {
  for (const [label, v] of [['customer fee', p.customerFeeCents], ['refund', p.refundCents]] as const) {
    assertCents(v, label);
    if (v < 0) throw new RangeError(`${label} cannot be negative`);
  }
  if (p.refundCents > p.customerFeeCents) throw new RangeError('cannot refund more delivery fee than was paid');
  return journal(`delivery-cancel:${p.shipmentId}`, 'delivery_cancelled', p.bookingGroupId, 'Delivery leg cancelled', [
    dr('unearned_hire', p.customerFeeCents),
    cr('refunds_payable', p.refundCents),
    cr('delivery_income', p.customerFeeCents - p.refundCents),
  ]);
}

/**
 * A delivery fee that was already EARNED (the leg was accepted or received,
 * `deliveryEarned` moved it to delivery_income) is refunded after all, by a
 * person's decision (closing a review, a staff cancellation with an explicit
 * fee refund). The income is reversed into refunds_payable; unearned hire no
 * longer holds it, so `deliveryCancelled` would count it twice. Same key as
 * `deliveryCancelled` (`delivery-cancel:{shipment}`): one fee-refund journal
 * per shipment, whichever form is posted first.
 */
export function deliveryEarnedRefund(p: { shipmentId: string; bookingGroupId: string; refundCents: number }): Journal {
  assertCents(p.refundCents, 'refund');
  if (p.refundCents <= 0) throw new RangeError('refund must be positive');
  return journal(`delivery-cancel:${p.shipmentId}`, 'delivery_cancelled', p.bookingGroupId, 'Earned delivery fee refunded', [
    dr('delivery_income', p.refundCents),
    cr('refunds_payable', p.refundCents),
  ]);
}

/**
 * Settles one booking line whose outcome a person decided: a staff
 * cancellation, or a resolved dispute. Every amount it held as a liability
 * (hire, deposit) is released. What goes back to the customer becomes
 * refunds_payable. What is kept becomes income: earned hire (split
 * owner/platform for community gear), kept deposit (damage income) or
 * retained hire on cancellation (cancellation income).
 */
export function personSettlement(p: {
  key: string;
  bookingGroupId: string;
  hireCents: number;
  depositCents: number;
  hireRefundCents: number;
  depositRefundCents: number;
  /** 'earned': kept hire is revenue (hire happened). 'cancelled': kept hire is a cancellation fee. */
  keptHireAs: 'earned' | 'cancelled';
  ownership: 'studio' | 'community';
  ownerShareCents: number;
  platformShareCents: number;
}): Journal {
  for (const [label, v] of [['hire', p.hireCents], ['deposit', p.depositCents], ['hire refund', p.hireRefundCents], ['deposit refund', p.depositRefundCents]] as const) {
    assertCents(v, label);
    if (v < 0) throw new RangeError(`${label} cannot be negative`);
  }
  if (p.hireRefundCents > p.hireCents || p.depositRefundCents > p.depositCents) throw new RangeError('cannot refund more than was held');
  const keptHire = p.hireCents - p.hireRefundCents;
  if (p.ownership === 'community' && p.keptHireAs === 'earned' && p.ownerShareCents + p.platformShareCents !== keptHire) {
    throw new RangeError('owner + platform share must equal the kept hire');
  }
  const keptHireLines =
    p.keptHireAs === 'cancelled'
      ? [cr('cancellation_income', keptHire)]
      : p.ownership === 'community'
        ? [cr('owner_payable', p.ownerShareCents), cr('platform_commission', p.platformShareCents)]
        : [cr('rental_revenue', keptHire)];
  return journal(p.key, p.keptHireAs === 'cancelled' ? 'cancellation' : 'deposit_settled', p.bookingGroupId, 'Settled by a person', [
    dr('unearned_hire', p.hireCents),
    dr('customer_deposits', p.depositCents),
    cr('refunds_payable', p.hireRefundCents + p.depositRefundCents),
    cr('damage_income', p.depositCents - p.depositRefundCents),
    ...keptHireLines,
  ]);
}
