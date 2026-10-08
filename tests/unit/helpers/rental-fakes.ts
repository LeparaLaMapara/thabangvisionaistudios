/**
 * In-memory adapters for the rental money ports. They copy the database's
 * compare-and-set semantics: a transition happens only from the expected
 * state, one journal per idempotency key, one outbox row per dedupe key, and
 * one refund obligation per key. These are test doubles, not a live
 * integration.
 */
import type {
  Clock,
  ConfirmOutcome,
  IntentRecord,
  PaymentPort,
  PayoutPort,
  PayoutRecord,
  PayoutRepository,
  ProviderCallResult,
  ProviderRefund,
  ProviderTransfer,
  RefundRecord,
  RefundRepository,
  RentalPaymentRepository,
} from '@/lib/core/ports';
import type { Journal } from '@/lib/core/rental/ledger';
import type { OutboxMessage } from '@/lib/core/rental/notifications';
import type { OrderLinesState } from '@/lib/core/rental/payments';

export class FakeClock implements Clock {
  constructor(public t: Date) {}
  now(): Date {
    return new Date(this.t);
  }
  advanceMinutes(m: number): void {
    this.t = new Date(this.t.getTime() + m * 60_000);
  }
}

export class Books {
  journals = new Map<string, Journal>();
  outbox = new Map<string, OutboxMessage>();
  append(j: Journal | null): boolean {
    if (!j) return true;
    if (this.journals.has(j.idempotencyKey)) return false;
    this.journals.set(j.idempotencyKey, j);
    return true;
  }
  enqueue(ns: OutboxMessage[]): void {
    for (const n of ns) if (!this.outbox.has(n.dedupeKey)) this.outbox.set(n.dedupeKey, n);
  }
}

export interface FakeLine {
  id: string;
  status: string;
  cancelReason: string | null;
  units: number;
  rentalId: string;
}

export class FakeRentalPayments implements RentalPaymentRepository {
  intents = new Map<string, IntentRecord>();
  lines = new Map<string, FakeLine[]>();
  refunds: FakeRefunds;
  /** Units of stock per rental id, and units taken by OTHER orders. */
  stock = new Map<string, number>();
  takenElsewhere = new Map<string, number>();
  failNextConfirm = false;

  constructor(public books: Books, refunds: FakeRefunds) {
    this.refunds = refunds;
  }

  async getIntent(reference: string): Promise<IntentRecord | null> {
    const i = this.intents.get(reference);
    return i ? { ...i } : null;
  }

  async getOrderLines(groupId: string): Promise<OrderLinesState> {
    const ls = this.lines.get(groupId) ?? [];
    const statuses: Record<string, number> = {};
    for (const l of ls) statuses[l.status] = (statuses[l.status] ?? 0) + 1;
    return { statuses, cancelledByExpiry: ls.filter((l) => l.status === 'cancelled' && l.cancelReason === 'hold_expired').length };
  }

  async confirmPayment(p: { reference: string; providerTransactionId: string; amountCents: number; late: boolean; journal: Journal; notices: OutboxMessage[] }): Promise<ConfirmOutcome> {
    // Simulates a transaction: either everything below happens or nothing.
    if (this.failNextConfirm) {
      this.failNextConfirm = false;
      throw new Error('simulated database failure');
    }
    const intent = this.intents.get(p.reference);
    if (!intent) return 'not_confirmable';
    if (intent.state === 'paid' && intent.providerTransactionId === p.providerTransactionId) return 'duplicate';
    if (!['initiated', 'failed', 'expired'].includes(intent.state)) return 'not_confirmable';
    const ls = this.lines.get(intent.checkoutGroupId) ?? [];
    const confirmable = ls.filter((l) => l.status === 'pending' || (p.late && l.status === 'cancelled' && l.cancelReason === 'hold_expired'));
    if (confirmable.length !== ls.length) return 'not_confirmable';
    if (p.late) {
      for (const l of ls) {
        const free = (this.stock.get(l.rentalId) ?? 1) - (this.takenElsewhere.get(l.rentalId) ?? 0);
        if (l.status === 'cancelled' && free < l.units) return 'unavailable';
      }
    }
    for (const l of ls) {
      l.status = 'confirmed';
      l.cancelReason = null;
    }
    intent.state = 'paid';
    intent.providerTransactionId = p.providerTransactionId;
    this.books.append(p.journal);
    this.books.enqueue(p.notices);
    return 'confirmed';
  }

  async recordUnallocatedPayment(p: {
    reference: string;
    providerTransactionId: string;
    amountCents: number;
    intentState: 'mismatch' | 'refund_due';
    reason: string;
    refund: { key: string; reason: RefundRecord['reason']; amountCents: number } | null;
    journal: Journal;
    notices: OutboxMessage[];
  }): Promise<'recorded' | 'duplicate'> {
    if (!this.books.append(p.journal)) return 'duplicate';
    const intent = this.intents.get(p.reference);
    if (intent && ['initiated', 'failed', 'expired'].includes(intent.state)) intent.state = p.intentState;
    if (p.refund) {
      this.refunds.create({
        obligationKey: p.refund.key,
        reason: p.refund.reason,
        amountCents: p.refund.amountCents,
        transactionReference: p.reference,
        userId: intent?.userId ?? null,
        bookingGroupId: intent?.checkoutGroupId ?? null,
        bookingIds: intent?.bookingIds ?? [],
        fromUnallocated: true,
        chargedCents: p.amountCents,
      });
    }
    this.books.enqueue(p.notices);
    return 'recorded';
  }

  async recordFailedAttempt(reference: string): Promise<void> {
    const i = this.intents.get(reference);
    if (i && i.state === 'initiated') i.state = 'failed';
  }
}

export class FakeRefunds implements RefundRepository {
  rows = new Map<string, RefundRecord>();
  /** Charged amount per transaction reference, for the "never refund more than charged" guard (T14). */
  charged = new Map<string, number>();
  private seq = 0;
  constructor(public books: Books, private clock: Clock) {}

  /** Mirrors the unique key + the sum-not-above-charge trigger. */
  create(p: Omit<RefundRecord, 'id' | 'state' | 'providerRefundId' | 'claimedAt' | 'attempts'> & { chargedCents?: number }): RefundRecord | null {
    for (const r of this.rows.values()) if (r.obligationKey === p.obligationKey) return null;
    if (p.chargedCents !== undefined && !this.charged.has(p.transactionReference)) this.charged.set(p.transactionReference, p.chargedCents);
    const charged = this.charged.get(p.transactionReference);
    if (charged !== undefined) {
      const already = [...this.rows.values()].filter((r) => r.transactionReference === p.transactionReference && r.state !== 'failed').reduce((s, r) => s + r.amountCents, 0);
      if (already + p.amountCents > charged) throw new Error('refunds would exceed the original charge');
    }
    const id = `rf_${++this.seq}`;
    const row: RefundRecord = { ...p, id, state: 'eligible', providerRefundId: null, claimedAt: null, attempts: 0, updatedAt: this.clock.now().toISOString() };
    delete (row as { chargedCents?: number }).chargedCents;
    this.rows.set(id, row);
    return row;
  }

  async get(id: string): Promise<RefundRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async findByProvider(p: { providerRefundId?: string | null; transactionReference?: string | null; amountCents?: number | null }): Promise<RefundRecord | null> {
    const all = [...this.rows.values()];
    const byId = p.providerRefundId ? all.find((r) => r.providerRefundId === p.providerRefundId) : undefined;
    const byTx = all.find((r) => r.transactionReference === p.transactionReference && (p.amountCents == null || r.amountCents === p.amountCents) && r.state !== 'processed');
    const r = byId ?? byTx;
    return r ? { ...r } : null;
  }

  async transition(
    id: string,
    from: readonly RefundRecord['state'][],
    to: RefundRecord['state'],
    patch: { providerRefundId?: string | null; lastError?: string | null; claim?: boolean },
    journal: Journal | null,
    notices: OutboxMessage[],
  ): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || !from.includes(r.state)) return false;
    r.state = to;
    r.updatedAt = this.clock.now().toISOString();
    if (patch.providerRefundId !== undefined && patch.providerRefundId !== null) r.providerRefundId = patch.providerRefundId;
    if (patch.claim) {
      r.claimedAt = this.clock.now().toISOString();
      r.attempts += 1;
    }
    this.books.append(journal);
    this.books.enqueue(notices);
    return true;
  }
}

/** A payment provider double. Records every call so tests can count real refunds. */
export class FakePaymentProvider implements PaymentPort {
  readonly provider = 'fake';
  calls: { transactionReference: string; amountCents: number; idempotencyKey: string }[] = [];
  providerRefunds: ProviderRefund[] = [];
  mode: 'ok' | 'timeout_after_send' | 'reject' | 'down' = 'ok';
  /** The status the provider answers a new refund with. */
  initialStatus = 'pending';
  private seq = 0;

  async refund(p: { transactionReference: string; amountCents: number; idempotencyKey: string }): Promise<ProviderCallResult<ProviderRefund>> {
    if (this.mode === 'down') return { ok: false, kind: 'unknown', message: 'provider unavailable' };
    if (this.mode === 'reject') return { ok: false, kind: 'rejected', message: 'Transaction has been fully reversed' };
    this.calls.push(p);
    const r = { providerRefundId: `prf_${++this.seq}`, status: this.initialStatus, amountCents: p.amountCents };
    this.providerRefunds.push(r);
    if (this.mode === 'timeout_after_send') return { ok: false, kind: 'unknown', message: 'timeout' };
    return { ok: true, value: r };
  }
  setStatus(providerRefundId: string, status: string): void {
    const r = this.providerRefunds.find((x) => x.providerRefundId === providerRefundId);
    if (r) r.status = status;
  }
  async listRefunds(): Promise<ProviderCallResult<ProviderRefund[]>> {
    if (this.mode === 'down') return { ok: false, kind: 'unknown', message: 'provider unavailable' };
    return { ok: true, value: [...this.providerRefunds] };
  }
  async verifyCharge(): Promise<ProviderCallResult<{ status: string; amountCents: number; currency: string; providerTransactionId: string }>> {
    return { ok: false, kind: 'unknown', message: 'not used' };
  }
}

export class FakePayouts implements PayoutRepository {
  rows = new Map<string, PayoutRecord>();
  constructor(public books: Books, private clock: Clock) {}
  async get(id: string): Promise<PayoutRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async getByReference(reference: string): Promise<PayoutRecord | null> {
    const r = [...this.rows.values()].find((x) => x.transferReference === reference);
    return r ? { ...r } : null;
  }
  async transition(
    id: string,
    from: readonly PayoutRecord['state'][],
    to: PayoutRecord['state'],
    patch: { providerTransferCode?: string | null; lastError?: string | null; claim?: boolean },
    journal: Journal | null,
    notices: OutboxMessage[],
  ): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || !from.includes(r.state)) return false;
    r.state = to;
    r.updatedAt = this.clock.now().toISOString();
    if (patch.providerTransferCode) r.providerTransferCode = patch.providerTransferCode;
    if (patch.claim) r.claimedAt = this.clock.now().toISOString();
    this.books.append(journal);
    this.books.enqueue(notices);
    return true;
  }
}

/** Transfer provider double: a repeated reference returns the existing transfer, like Paystack. */
export class FakeTransferProvider implements PayoutPort {
  readonly provider = 'fake';
  sent = new Map<string, ProviderTransfer>();
  moneyMoved = 0;
  mode: 'ok' | 'timeout_after_send' | 'down' = 'ok';
  async transfer(p: { reference: string; amountCents: number; recipientCode: string }): Promise<ProviderCallResult<ProviderTransfer>> {
    if (this.mode === 'down') return { ok: false, kind: 'unknown', message: 'provider unavailable' };
    let t = this.sent.get(p.reference);
    if (!t) {
      t = { transferCode: `TRF_${p.reference}`, status: 'pending', amountCents: p.amountCents };
      this.sent.set(p.reference, t);
      this.moneyMoved += p.amountCents;
    }
    if (this.mode === 'timeout_after_send') return { ok: false, kind: 'unknown', message: 'timeout' };
    return { ok: true, value: t };
  }
  setStatus(reference: string, status: string): void {
    const t = this.sent.get(reference);
    if (t) t.status = status;
  }
  async verifyTransfer(reference: string): Promise<ProviderCallResult<ProviderTransfer | null>> {
    if (this.mode === 'down') return { ok: false, kind: 'unknown', message: 'provider unavailable' };
    return { ok: true, value: this.sent.get(reference) ?? null };
  }
}
