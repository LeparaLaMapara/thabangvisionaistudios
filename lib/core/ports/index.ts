/**
 * Ports: the only way core use cases reach the outside world (spec §4).
 * Adapters live in lib/adapters/** and lib/payments/**. Core code imports
 * these interfaces, never a provider SDK, Supabase or Next.js.
 */

import type { Journal } from '@/lib/core/rental/ledger';
import type { OutboxMessage } from '@/lib/core/rental/notifications';
import type { IntentState, OrderLinesState } from '@/lib/core/rental/payments';
import type { RefundReason, RefundState } from '@/lib/core/rental/refunds';
import type { PayoutState } from '@/lib/core/rental/payouts';
import type { PaymentCapabilities, PayoutCapabilities } from '@/lib/core/payments/capabilities';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

// ── Payments ─────────────────────────────────────────────────────────────────

export type ProviderCallResult<T> =
  | { ok: true; value: T }
  /** The provider definitely refused (4xx with a clear reason). Safe to mark failed. */
  | { ok: false; kind: 'rejected'; message: string }
  /** Timeout, network error or 5xx: the outcome is UNKNOWN. Reconcile before any retry. */
  | { ok: false; kind: 'unknown'; message: string };

export interface ProviderRefund {
  providerRefundId: string;
  status: string;
  amountCents: number;
}

export interface PaymentPort {
  readonly provider: string;
  /** What this adapter can do; a caller needing more is refused (spec §8.4). */
  readonly capabilities: PaymentCapabilities;
  /** Refund part or all of a charge. `idempotencyKey` is sent where the provider supports it. */
  refund(params: { transactionReference: string; amountCents: number; idempotencyKey: string }): Promise<ProviderCallResult<ProviderRefund>>;
  /** Refunds the provider holds for a charge. Used to reconcile after an unknown outcome. */
  listRefunds(transactionReference: string): Promise<ProviderCallResult<ProviderRefund[]>>;
  /** Server-side verification of a charge, never trusting the browser. */
  verifyCharge(reference: string): Promise<ProviderCallResult<{ status: string; amountCents: number; currency: string; providerTransactionId: string }>>;
}

export interface ProviderTransfer {
  transferCode: string;
  status: string;
  amountCents: number;
}

export interface PayoutPort {
  readonly provider: string;
  readonly capabilities: PayoutCapabilities;
  /** Send money to a validated recipient under a stable reference. Re-sending the same reference must not pay twice. */
  transfer(params: { reference: string; amountCents: number; recipientCode: string; reason: string }): Promise<ProviderCallResult<ProviderTransfer>>;
  /** Look a transfer up by our reference. */
  verifyTransfer(reference: string): Promise<ProviderCallResult<ProviderTransfer | null>>;
}

export interface IdentityPort {
  readonly provider: string;
  /**
   * Check that a South African bank account exists and belongs to the named
   * person. This is NOT identity verification: no document authenticity and
   * no liveness check.
   */
  validateBankAccount(params: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    accountType: 'personal' | 'business';
    documentType: 'identityNumber' | 'passportNumber' | 'businessRegistrationNumber';
    documentNumber: string;
  }): Promise<ProviderCallResult<{ verified: boolean; message: string }>>;
}

export interface NotifyPort {
  /** Deliver one outbox message on its channel. Must be safe to call twice for the same dedupe key. */
  deliver(message: OutboxMessage): Promise<{ ok: true } | { ok: false; retryable: boolean; message: string }>;
}

// ── Repositories ─────────────────────────────────────────────────────────────

export interface IntentRecord {
  reference: string;
  checkoutGroupId: string;
  state: IntentState;
  userId: string;
  expectedAmountCents: number;
  hireCents: number;
  depositCents: number;
  deliveryCents: number;
  currency: 'ZAR';
  providerTransactionId: string | null;
  holdExpiresAt: string;
  bookingIds: string[];
}

export type ConfirmOutcome = 'confirmed' | 'duplicate' | 'unavailable' | 'not_confirmable';

export interface RentalPaymentRepository {
  getIntent(reference: string): Promise<IntentRecord | null>;
  getOrderLines(checkoutGroupId: string): Promise<OrderLinesState>;
  /**
   * In ONE transaction: re-check stock under lock if `late`, move pending (or
   * expiry-cancelled when late) lines to confirmed, mark the intent paid with
   * the provider transaction id, append the journal, enqueue the notices.
   */
  confirmPayment(p: {
    reference: string;
    providerTransactionId: string;
    amountCents: number;
    late: boolean;
    journal: Journal;
    notices: OutboxMessage[];
  }): Promise<ConfirmOutcome>;
  /**
   * In ONE transaction: mark the intent `mismatch` or `refund_due`, record the
   * money as unallocated, create the refund obligation (unique key), enqueue
   * alerts.
   */
  recordUnallocatedPayment(p: {
    reference: string;
    providerTransactionId: string;
    amountCents: number;
    intentState: 'mismatch' | 'refund_due';
    reason: string;
    refund: { key: string; reason: RefundReason; amountCents: number } | null;
    journal: Journal;
    notices: OutboxMessage[];
  }): Promise<'recorded' | 'duplicate'>;
  recordFailedAttempt(reference: string): Promise<void>;
}

export interface RefundRecord {
  id: string;
  obligationKey: string;
  reason: RefundReason;
  state: RefundState;
  amountCents: number;
  transactionReference: string;
  providerRefundId: string | null;
  claimedAt: string | null;
  attempts: number;
  updatedAt?: string | null;
  userId: string | null;
  bookingGroupId: string | null;
  bookingIds: string[];
  fromUnallocated: boolean;
  /** False for orders outside the ledger: no journal when it completes. Defaults to true. */
  ledgered?: boolean;
}

export interface RefundRepository {
  get(id: string): Promise<RefundRecord | null>;
  findByProvider(p: { providerRefundId?: string | null; transactionReference?: string | null; amountCents?: number | null }): Promise<RefundRecord | null>;
  /** Compare-and-set: only moves if the state is still one of `from`. Returns false if someone else moved it. */
  transition(
    id: string,
    from: readonly RefundState[],
    to: RefundState,
    patch: { providerRefundId?: string | null; lastError?: string | null; claim?: boolean },
    journal: Journal | null,
    notices: OutboxMessage[],
  ): Promise<boolean>;
}

export interface PayoutRecord {
  id: string;
  bookingId: string;
  ownerId: string;
  state: PayoutState;
  amountCents: number;
  transferReference: string;
  recipientCode: string | null;
  providerTransferCode: string | null;
  claimedAt: string | null;
  updatedAt?: string | null;
  bookingGroupId: string | null;
}

export interface PayoutRepository {
  get(id: string): Promise<PayoutRecord | null>;
  getByReference(reference: string): Promise<PayoutRecord | null>;
  transition(
    id: string,
    from: readonly PayoutState[],
    to: PayoutState,
    patch: { providerTransferCode?: string | null; lastError?: string | null; claim?: boolean; recipientCode?: string | null; holdReasons?: string[]; approvedBy?: string | null },
    journal: Journal | null,
    notices: OutboxMessage[],
  ): Promise<boolean>;
}
