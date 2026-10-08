import { createAdminClient } from '@/lib/supabase/server';
import type {
  ConfirmOutcome,
  IntentRecord,
  PayoutRecord,
  PayoutRepository,
  RefundRecord,
  RefundRepository,
  RentalPaymentRepository,
} from '@/lib/core/ports';
import type { OrderLinesState } from '@/lib/core/rental/payments';

/**
 * Supabase adapters for the rental money ports. Every state change goes
 * through a SECURITY DEFINER function from migration 070, so the change,
 * its ledger journal and its notifications commit together or not at all.
 * Service role only.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** True when the database has not had migration 070 applied (function or table missing). */
export function isMissingPipeline(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' || // function not found in schema cache
    error.code === '42883' || // undefined function
    error.code === '42P01' || // undefined table
    error.code === 'PGRST205' || // table not found in schema cache
    /could not find the function|does not exist/i.test(error.message ?? '')
  );
}

function rpcError(name: string, error: { message?: string; code?: string }): Error {
  const e = new Error(`${name} failed: ${error.message ?? 'unknown'}`);
  (e as Error & { code?: string }).code = error.code;
  return e;
}

interface IntentRow {
  reference: string;
  checkout_group_id: string;
  state: IntentRecord['state'];
  user_id: string;
  expected_amount_cents: number;
  hire_cents: number;
  deposit_cents: number;
  delivery_cents: number;
  provider_transaction_id: string | null;
  hold_expires_at: string;
}

export class SupabaseRentalPayments implements RentalPaymentRepository {
  constructor(private db: Admin = createAdminClient()) {}

  async getIntent(reference: string): Promise<IntentRecord | null> {
    const { data, error } = await this.db
      .from('rental_payment_intents')
      .select('reference, checkout_group_id, state, user_id, expected_amount_cents, hire_cents, deposit_cents, delivery_cents, provider_transaction_id, hold_expires_at')
      .eq('reference', reference)
      .maybeSingle();
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw rpcError('getIntent', error);
    }
    if (!data) return null;
    const row = data as IntentRow;
    const { data: lines, error: linesErr } = await this.db.from('equipment_bookings').select('id').eq('checkout_group_id', row.checkout_group_id).order('created_at');
    if (linesErr) throw rpcError('getIntent lines', linesErr);
    return {
      reference: row.reference,
      checkoutGroupId: row.checkout_group_id,
      state: row.state,
      userId: row.user_id,
      expectedAmountCents: row.expected_amount_cents,
      hireCents: row.hire_cents,
      depositCents: row.deposit_cents,
      deliveryCents: row.delivery_cents,
      currency: 'ZAR',
      providerTransactionId: row.provider_transaction_id,
      holdExpiresAt: row.hold_expires_at,
      bookingIds: (lines ?? []).map((l) => (l as { id: string }).id),
    };
  }

  async getOrderLines(checkoutGroupId: string): Promise<OrderLinesState> {
    const { data, error } = await this.db.from('equipment_bookings').select('status, cancel_reason').eq('checkout_group_id', checkoutGroupId);
    if (error) throw rpcError('getOrderLines', error);
    const statuses: Record<string, number> = {};
    let cancelledByExpiry = 0;
    for (const row of (data ?? []) as { status: string; cancel_reason: string | null }[]) {
      statuses[row.status] = (statuses[row.status] ?? 0) + 1;
      if (row.status === 'cancelled' && row.cancel_reason === 'hold_expired') cancelledByExpiry += 1;
    }
    return { statuses, cancelledByExpiry };
  }

  async confirmPayment(p: Parameters<RentalPaymentRepository['confirmPayment']>[0]): Promise<ConfirmOutcome> {
    const { data, error } = await this.db.rpc('confirm_rental_payment', {
      p_reference: p.reference,
      p_provider_transaction_id: p.providerTransactionId,
      p_amount_cents: p.amountCents,
      p_late: p.late,
      p_journal: p.journal,
      p_notices: p.notices,
    });
    if (error) throw rpcError('confirm_rental_payment', error);
    return data as ConfirmOutcome;
  }

  async recordUnallocatedPayment(p: Parameters<RentalPaymentRepository['recordUnallocatedPayment']>[0]): Promise<'recorded' | 'duplicate'> {
    const { data, error } = await this.db.rpc('record_unallocated_payment', {
      p_reference: p.reference,
      p_provider_transaction_id: p.providerTransactionId,
      p_amount_cents: p.amountCents,
      p_intent_state: p.intentState,
      p_reason: p.reason,
      p_refund: p.refund,
      p_journal: p.journal,
      p_notices: p.notices,
    });
    if (error) throw rpcError('record_unallocated_payment', error);
    return data as 'recorded' | 'duplicate';
  }

  async recordFailedAttempt(reference: string): Promise<void> {
    const { error } = await this.db.rpc('record_failed_payment_attempt', { p_reference: reference });
    if (error) throw rpcError('record_failed_payment_attempt', error);
  }
}

interface RefundRow {
  id: string;
  obligation_key: string;
  reason: RefundRecord['reason'];
  state: RefundRecord['state'];
  amount_cents: number;
  transaction_reference: string;
  provider_refund_id: string | null;
  claimed_at: string | null;
  attempts: number;
  updated_at: string | null;
  user_id: string | null;
  booking_group_id: string | null;
  booking_ids: string[] | null;
  from_unallocated: boolean;
}

const REFUND_COLUMNS =
  'id, obligation_key, reason, state, amount_cents, transaction_reference, provider_refund_id, claimed_at, attempts, updated_at, user_id, booking_group_id, booking_ids, from_unallocated';

function toRefund(r: RefundRow): RefundRecord {
  return {
    id: r.id,
    obligationKey: r.obligation_key,
    reason: r.reason,
    state: r.state,
    amountCents: r.amount_cents,
    transactionReference: r.transaction_reference,
    providerRefundId: r.provider_refund_id,
    claimedAt: r.claimed_at,
    attempts: r.attempts,
    updatedAt: r.updated_at,
    userId: r.user_id,
    bookingGroupId: r.booking_group_id,
    bookingIds: r.booking_ids ?? [],
    fromUnallocated: r.from_unallocated,
  };
}

export class SupabaseRefunds implements RefundRepository {
  constructor(private db: Admin = createAdminClient()) {}

  async get(id: string): Promise<RefundRecord | null> {
    const { data, error } = await this.db.from('refund_obligations').select(REFUND_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw rpcError('refund get', error);
    return data ? toRefund(data as RefundRow) : null;
  }

  async findByProvider(p: { providerRefundId?: string | null; transactionReference?: string | null; amountCents?: number | null }): Promise<RefundRecord | null> {
    if (p.providerRefundId) {
      const { data, error } = await this.db.from('refund_obligations').select(REFUND_COLUMNS).eq('provider_refund_id', p.providerRefundId).maybeSingle();
      // A failed lookup is not "unknown refund": throw so the event is retried.
      if (error) throw rpcError('refund findByProvider', error);
      if (data) return toRefund(data as RefundRow);
    }
    if (p.transactionReference) {
      let q = this.db.from('refund_obligations').select(REFUND_COLUMNS).eq('transaction_reference', p.transactionReference).neq('state', 'processed');
      if (p.amountCents != null) q = q.eq('amount_cents', p.amountCents);
      const { data, error } = await q.order('created_at').limit(2);
      if (error) throw rpcError('refund findByProvider', error);
      // Only match when it is unambiguous.
      if (data && data.length === 1) return toRefund(data[0] as RefundRow);
    }
    return null;
  }

  async transition(...[id, from, to, patch, journal, notices]: Parameters<RefundRepository['transition']>): Promise<boolean> {
    const { data, error } = await this.db.rpc('refund_transition', {
      p_id: id,
      p_from: from as string[],
      p_to: to,
      p_patch: patch,
      p_journal: journal,
      p_notices: notices,
    });
    if (error) throw rpcError('refund_transition', error);
    return data === true;
  }
}

interface PayoutRow {
  id: string;
  booking_id: string;
  owner_id: string;
  state: PayoutRecord['state'];
  owner_amount_cents: number;
  transfer_reference: string;
  recipient_code: string | null;
  provider_transfer_code: string | null;
  claimed_at: string | null;
  updated_at: string | null;
  booking_group_id: string | null;
}

const PAYOUT_COLUMNS = 'id, booking_id, owner_id, state, owner_amount_cents, transfer_reference, recipient_code, provider_transfer_code, claimed_at, updated_at, booking_group_id';

function toPayout(r: PayoutRow): PayoutRecord {
  return {
    id: r.id,
    bookingId: r.booking_id,
    ownerId: r.owner_id,
    state: r.state,
    amountCents: r.owner_amount_cents,
    transferReference: r.transfer_reference,
    recipientCode: r.recipient_code,
    providerTransferCode: r.provider_transfer_code,
    claimedAt: r.claimed_at,
    updatedAt: r.updated_at,
    bookingGroupId: r.booking_group_id,
  };
}

export class SupabasePayouts implements PayoutRepository {
  constructor(private db: Admin = createAdminClient()) {}

  async get(id: string): Promise<PayoutRecord | null> {
    const { data, error } = await this.db.from('owner_payouts').select(PAYOUT_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw rpcError('payout get', error);
    return data ? toPayout(data as PayoutRow) : null;
  }

  async getByReference(reference: string): Promise<PayoutRecord | null> {
    const { data, error } = await this.db.from('owner_payouts').select(PAYOUT_COLUMNS).eq('transfer_reference', reference).maybeSingle();
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw rpcError('payout getByReference', error);
    }
    return data ? toPayout(data as PayoutRow) : null;
  }

  async transition(...[id, from, to, patch, journal, notices]: Parameters<PayoutRepository['transition']>): Promise<boolean> {
    const { data, error } = await this.db.rpc('payout_transition', {
      p_id: id,
      p_from: from as string[],
      p_to: to,
      p_patch: patch,
      p_journal: journal,
      p_notices: notices,
    });
    if (error) throw rpcError('payout_transition', error);
    return data === true;
  }
}

/** Guarded booking transition via transition_rental_booking. */
export async function transitionBookings(
  db: Admin,
  p: {
    ids: string[];
    from: readonly string[];
    to: string;
    actor: 'system' | 'customer' | 'staff' | 'owner';
    actorId: string | null;
    reason: string | null;
    patch?: Record<string, unknown>;
    journals?: unknown[];
    refunds?: unknown[];
    payouts?: unknown[];
    notices?: unknown[];
  },
): Promise<{ result: 'moved' | 'already' | 'conflict'; count: number } | { result: 'missing_pipeline' }> {
  const { data, error } = await db.rpc('transition_rental_booking', {
    p_ids: p.ids,
    p_from: p.from as string[],
    p_to: p.to,
    p_actor: p.actor,
    p_actor_id: p.actorId,
    p_reason: p.reason,
    p_patch: p.patch ?? {},
    p_journals: p.journals ?? [],
    p_refunds: p.refunds ?? [],
    p_payouts: p.payouts ?? [],
    p_notices: p.notices ?? [],
  });
  if (error) {
    if (isMissingPipeline(error)) return { result: 'missing_pipeline' };
    throw rpcError('transition_rental_booking', error);
  }
  const n = Number(data);
  if (n > 0) return { result: 'moved', count: n };
  if (n === 0) return { result: 'already', count: 0 };
  return { result: 'conflict', count: 0 };
}
