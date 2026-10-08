import { assertCents } from '@/lib/core/pricing/money';

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
  | 'adjustment';

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
