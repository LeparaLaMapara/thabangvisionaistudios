import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { createTransferRecipient, type TransferRecipientResult } from '@/lib/payments/paystack';
import { verifyPayment } from '@/lib/payments/routing';
import { payoutAdapterFor } from '@/lib/payments/ports';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { toCents } from '@/lib/core/pricing/money';
import type { PayoutPort } from '@/lib/core/ports';
import {
  checkServicePayoutEligibility,
  payoutDueAt,
  PAYOUT_BLOCK_WORDS,
  type ServicePayoutBlock,
} from '@/lib/core/services/fulfilment';
import {
  afterServicePayoutLookup,
  nextServicePayoutStep,
} from '@/lib/core/services/payouts';
import {
  countOpenServiceDisputes,
  readServiceBooking,
  recordServiceBookingEvent,
  updateServiceBooking,
} from '@/lib/supabase/queries/service-bookings';

// ─── Payout recipients ───────────────────────────────────────────────────────

/** Whether payout recipients can be registered here (Paystack secret key set). */
export function payoutRecipientsConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

/**
 * Register a creator's South African bank account with the payout provider
 * (Paystack Transfers) and return the recipient code that triggerCreatorPayout
 * pays. Routes call this, never the provider directly. The account number is
 * passed through to the provider only; callers store the last four digits.
 */
export async function createPayoutRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<TransferRecipientResult> {
  return createTransferRecipient(params);
}

interface PayoutParams {
  bookingId: string;
  /** Kept for callers; ignored. Everything is read from the booking itself. */
  reference?: string;
  creatorId?: string;
  creatorAmount?: number;
  projectCategory?: string;
}

export type PayoutOutcome =
  /** A transfer was requested under the booking's stable reference. */
  | 'sent'
  /** The provider confirmed an earlier transfer; recorded as paid. */
  | 'reconciled_paid'
  /** A transfer is with the provider; its webhook will finish it. */
  | 'in_flight'
  /** Not allowed or not due yet; nothing was sent. */
  | 'blocked'
  /** Could not decide safely this time (provider unreachable); try again later. */
  | 'retry_later'
  /** A person must look at it. Nothing was sent. */
  | 'escalated'
  | 'already_paid'
  | 'error';

export interface PayoutResult {
  success: boolean;
  outcome: PayoutOutcome;
  error?: string;
  reasons?: ServicePayoutBlock[];
  payoutReference?: string;
}

/**
 * Why a booking may not be paid out, or null when it may. Kept for the
 * existing guards and tests; the full rule set (dispute, due time, validated
 * account) is checkServicePayoutEligibility in lib/core/services/fulfilment.ts.
 */
export function payoutBlocker(
  booking: {
    status: string | null;
    payment_status: string | null;
    payout_status: string | null;
    creator_id: string | null;
    creator_amount: number | null;
    total: number | null;
  },
  verified: { success: boolean; amount: number } | null,
  /** The creator's ID check has passed. triggerCreatorPayout always passes it. */
  creatorVerified?: boolean,
): string | null {
  if (!booking.creator_id) return 'No creator on the booking';
  if (creatorVerified === false) return 'The creator has not passed the ID check';
  if (booking.status !== 'completed') return `Booking is ${booking.status ?? 'unknown'}, not completed`;
  if (booking.payment_status !== 'paid') return 'Booking is not marked paid';
  if (booking.payout_status === 'processing' || booking.payout_status === 'paid') return 'Payout already started';
  if (!booking.creator_amount || booking.creator_amount <= 0) return 'No creator amount';
  if (!booking.total || booking.creator_amount > booking.total) return 'Creator amount is more than the booking total';
  if (!verified || !verified.success) return 'The payment provider does not confirm this payment';
  if (Math.round(verified.amount) < booking.total) return `Provider confirms R${verified.amount}, less than the total R${booking.total}`;
  return null;
}

interface PayoutBookingRow {
  id: string;
  reference: string;
  paystack_reference: string | null;
  status: string | null;
  payment_status: string | null;
  payout_status: string | null;
  payout_reference: string | null;
  payout_retry_count: number | null;
  creator_id: string | null;
  creator_amount: number | null;
  total: number | null;
  project_category: string | null;
  completed_at: string | null;
  updated_at: string | null;
  payout_due_at?: string | null;
  payout_claimed_at?: string | null;
}

const BASE_COLUMNS = 'id, reference, paystack_reference, status, payment_status, payout_status, payout_reference, payout_retry_count, creator_id, creator_amount, total, project_category, completed_at, updated_at';
const EXTRA_COLUMNS = 'payout_due_at, payout_claimed_at';

export interface PayoutDeps {
  db: SupabaseClient;
  /** The payout adapter. Default: whichever adapter can do verified bank transfers. */
  transfers: PayoutPort | null;
  /** Server-side check of the client's payment (rands). */
  verifyCharge: (reference: string) => Promise<{ success: boolean; amount: number }>;
  now: Date;
}

/** Fills in what the caller did not pass. Only builds what is missing. */
function withDefaults(deps: Partial<PayoutDeps>): PayoutDeps {
  let transfers = deps.transfers;
  if (transfers === undefined) {
    const selected = payoutAdapterFor(['bankTransfers', 'transferVerification']);
    transfers = selected.ok ? selected.adapter : null;
  }
  return {
    db: deps.db ?? createAdminClient(),
    transfers,
    verifyCharge: deps.verifyCharge ?? verifyPayment,
    now: deps.now ?? new Date(),
  };
}

/**
 * Pay a creator for a completed service booking, from ThabangVision's balance.
 * Called by the daily maintenance job and the admin "pay out" action only:
 * approving a delivery never pays on the spot.
 *
 * - Everything is read from the database; the caller's amounts are ignored.
 * - One stable transfer reference per booking (tvsp_<booking id>). Before
 *   anything is sent again, the reference on record is looked up with the
 *   provider; a new reference is never invented for the same booking.
 * - Before money moves: the booking is completed and paid, the provider
 *   confirms the payment for at least the total, the creator passed the ID
 *   check and has a validated bank account, no dispute is open (a failed
 *   dispute lookup holds the payout), and the payout is due
 *   (STUDIO.booking.payoutDelayHours after completion).
 * - The send is claimed atomically, so two callers cannot both send it.
 * - The transfer goes through the payout port (lib/payments/ports.ts), never a
 *   provider module directly.
 */
export async function triggerCreatorPayout(params: PayoutParams, deps: Partial<PayoutDeps> = {}): Promise<PayoutResult> {
  const d: PayoutDeps = withDefaults(deps);
  const { db, now } = d;

  const read = await readServiceBooking<PayoutBookingRow>(db, params.bookingId, BASE_COLUMNS, EXTRA_COLUMNS);
  if (read.error || !read.data) {
    return { success: false, outcome: 'error', error: `Booking not found: ${read.error ?? 'no row'}` };
  }
  const booking = read.data;

  if (!d.transfers) {
    return { success: false, outcome: 'blocked', error: 'No payout provider supports verified bank transfers for ZAR' };
  }

  let step = nextServicePayoutStep(
    {
      bookingId: booking.id,
      payoutStatus: booking.payout_status,
      payoutReference: booking.payout_reference,
      claimedAt: booking.payout_claimed_at ?? booking.updated_at,
      attempts: booking.payout_retry_count ?? 0,
    },
    now,
    { maxAttempts: STUDIO.booking.maxPayoutAttempts },
  );

  if (step.step === 'done') return { success: true, outcome: 'already_paid', payoutReference: booking.payout_reference ?? undefined };
  if (step.step === 'wait') return { success: false, outcome: 'in_flight', error: step.why, payoutReference: booking.payout_reference ?? undefined };
  if (step.step === 'escalate') return escalate(db, booking, step.why);

  // Something may have been sent before: ask the provider first.
  if (step.step === 'lookup') {
    const looked = await d.transfers.verifyTransfer(step.reference);
    const next = afterServicePayoutLookup(looked, booking.id);
    if (next.then === 'mark_paid') {
      await markPaid(db, booking, step.reference, now);
      return { success: true, outcome: 'reconciled_paid', payoutReference: step.reference };
    }
    if (next.then === 'mark_in_flight') {
      if (booking.payout_status !== 'processing') {
        await updateServiceBooking(db, booking.id, null, { payout_status: 'processing', payout_reference: step.reference, payout_last_error: null, updated_at: now.toISOString() });
      }
      return { success: false, outcome: 'in_flight', error: 'transfer is with the provider', payoutReference: step.reference };
    }
    if (next.then === 'wait') return { success: false, outcome: 'retry_later', error: next.why };
    if (next.then === 'escalate') return escalate(db, booking, next.why, step.reference);
    step = { step: 'send', reference: next.reference };
  }

  // ── Before any money moves: every rule must hold. ─────────────────────────
  const paymentRef = booking.paystack_reference || booking.reference;
  let confirmation: { success: boolean; amount: number } | null = null;
  try {
    confirmation = paymentRef ? await d.verifyCharge(paymentRef) : null;
  } catch (err) {
    console.error('[payout] payment verification failed:', err);
  }
  const [{ data: creator }, { data: bank, error: bankError }, openDisputes] = await Promise.all([
    booking.creator_id
      ? db.from('profiles').select('verification_status').eq('id', booking.creator_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    booking.creator_id
      ? db.from('banking_details').select('is_verified, paystack_recipient_code, account_holder').eq('user_id', booking.creator_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    countOpenServiceDisputes(db, booking.id),
  ]);
  const bankRow = (bankError ? null : bank) as { is_verified?: boolean | null; paystack_recipient_code?: string | null; account_holder?: string | null } | null;

  const eligibility = checkServicePayoutEligibility(
    {
      status: booking.status,
      paymentStatus: booking.payment_status,
      payoutStatus: booking.payout_status,
      creatorId: booking.creator_id,
      creatorVerified: (creator as { verification_status?: string } | null)?.verification_status === 'verified',
      payoutAccountValidated: Boolean(bankRow?.is_verified && bankRow?.paystack_recipient_code),
      creatorAmount: booking.creator_amount,
      total: booking.total,
      providerConfirmation: confirmation,
      openDisputes,
      completedAt: booking.completed_at,
      payoutDueAt: booking.payout_due_at ?? null,
    },
    now,
  );
  if (!eligibility.eligible) {
    return {
      success: false,
      outcome: 'blocked',
      reasons: eligibility.reasons,
      error: eligibility.reasons.map((r) => PAYOUT_BLOCK_WORDS[r]).join('; '),
    };
  }

  // ── Claim: only one caller moves it out of the state we read. ─────────────
  const priorAttempt = Boolean(booking.payout_reference) || booking.payout_status === 'failed';
  const claimPatch: Record<string, unknown> = {
    payout_status: 'processing',
    payout_reference: step.reference,
    payout_claimed_at: now.toISOString(),
    payout_last_error: null,
    payout_retry_count: (booking.payout_retry_count ?? 0) + (priorAttempt ? 1 : 0),
    updated_at: now.toISOString(),
  };
  const claimed = await claim(db, booking, claimPatch);
  if (!claimed) return { success: false, outcome: 'in_flight', error: 'Payout already started by another process' };

  const amountCents = toCents(Number(booking.creator_amount));
  const result = await d.transfers.transfer({
    reference: step.reference,
    amountCents,
    recipientCode: String(bankRow?.paystack_recipient_code),
    reason: `Gig payout: ${booking.project_category ?? 'service'} (${booking.reference})`,
  });

  if (!result.ok && result.kind === 'rejected') {
    // The provider definitely refused: nothing moved. The next run looks the
    // same reference up before trying again.
    await updateServiceBooking(db, booking.id, null, { payout_status: 'failed', payout_last_error: result.message, updated_at: new Date().toISOString() });
    await recordServiceBookingEvent(db, { bookingId: booking.id, event: 'payout_refused', from: booking.status, to: booking.status, actor: 'system', actorId: null, reason: result.message });
    return { success: false, outcome: 'error', error: result.message, payoutReference: step.reference };
  }
  if (!result.ok) {
    // Outcome unknown: stays 'processing' under the same reference; the next
    // run looks it up before doing anything else.
    await updateServiceBooking(db, booking.id, null, { payout_last_error: `unknown outcome: ${result.message}` });
    return { success: false, outcome: 'retry_later', error: result.message, payoutReference: step.reference };
  }

  await recordServiceBookingEvent(db, { bookingId: booking.id, event: 'payout_sent', from: booking.status, to: booking.status, actor: 'system', actorId: null, reason: step.reference });
  if (result.value.status === 'success') {
    await markPaid(db, booking, step.reference, new Date());
  }

  try {
    await db.from('notifications').insert({
      user_id: booking.creator_id,
      type: 'payout_processing',
      title: 'Payout sent',
      body: `Your payout of R${booking.creator_amount} for ${booking.project_category} (${booking.reference}) has been sent. When it shows in your account depends on your bank.`,
      link: '/dashboard/gigs',
    });
    const { data: authUser } = await db.auth.admin.getUserById(String(booking.creator_id));
    if (authUser?.user?.email) {
      await emailProvider.sendEmail({
        to: authUser.user.email,
        subject: `Payout sent — ${STUDIO.name}`,
        text: `Hi ${bankRow?.account_holder ?? ''},\n\nYour payout of R${booking.creator_amount} for the ${booking.project_category} gig (${booking.reference}) has been sent from ${STUDIO.name}.\n\nWhen it shows in your bank account depends on your bank; we cannot promise a time. If it has not arrived after a few business days, reply to this email with the reference ${booking.reference}.\n\nThank you,\n${STUDIO.name}`,
      });
    }
  } catch { /* notices never block a payout */ }

  return { success: true, outcome: 'sent', payoutReference: step.reference };
}

async function claim(db: SupabaseClient, booking: PayoutBookingRow, patch: Record<string, unknown>): Promise<boolean> {
  const run = async (values: Record<string, unknown>) => {
    let q = db.from('bookings').update(values).eq('id', booking.id);
    q = booking.payout_status === null ? q.is('payout_status', null) : q.eq('payout_status', booking.payout_status);
    q = booking.payout_reference === null ? q.is('payout_reference', null) : q.eq('payout_reference', booking.payout_reference);
    if (booking.updated_at) q = q.eq('updated_at', booking.updated_at);
    return q.select('id');
  };
  let { data, error } = await run(patch);
  if (error && /payout_claimed_at|payout_last_error/.test(error.message)) {
    const { payout_claimed_at: _c, payout_last_error: _e, ...rest } = patch;
    void _c;
    void _e;
    ({ data, error } = await run(rest));
  }
  if (error) {
    console.error('[payout] claim failed:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function markPaid(db: SupabaseClient, booking: PayoutBookingRow, reference: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const patch: Record<string, unknown> = { payout_status: 'paid', payout_reference: reference, paid_out_at: at, payout_last_error: null, updated_at: at };
  if (booking.status === 'completed') patch.status = 'paid_out';
  await updateServiceBooking(db, booking.id, null, patch);
  await recordServiceBookingEvent(db, { bookingId: booking.id, event: 'payout_confirmed', from: booking.status, to: (patch.status as string | undefined) ?? booking.status, actor: 'system', actorId: null, reason: reference });
}

async function escalate(db: SupabaseClient, booking: PayoutBookingRow, why: string, reference?: string): Promise<PayoutResult> {
  await updateServiceBooking(db, booking.id, null, { payout_last_error: `needs a person: ${why}` });
  return { success: false, outcome: 'escalated', error: why, payoutReference: reference ?? booking.payout_reference ?? undefined };
}

// ─── The daily run ───────────────────────────────────────────────────────────

export interface ServicePayoutRunSummary {
  considered: number;
  notDue: number;
  outcomes: Partial<Record<PayoutOutcome, number>>;
  /** Bookings a person must look at, with why. */
  attention: { reference: string; why: string }[];
  /** Due but held by a rule (no validated account, open dispute, …). */
  held: { reference: string; why: string }[];
}

/**
 * Send every creator payout that is due and allowed, and reconcile every one
 * already with the provider. Runs from the daily maintenance cron. Bookings
 * that are not yet due are skipped without asking the provider anything.
 */
export async function runServicePayouts(deps: Partial<PayoutDeps> = {}, limit = 50): Promise<ServicePayoutRunSummary> {
  const d: PayoutDeps = withDefaults(deps);
  const summary: ServicePayoutRunSummary = { considered: 0, notDue: 0, outcomes: {}, attention: [], held: [] };

  const select = (columns: string) => d.db
    .from('bookings')
    .select(columns)
    .not('creator_id', 'is', null)
    .or('payout_status.eq.processing,and(status.eq.completed,payment_status.eq.paid,or(payout_status.is.null,payout_status.in.(pending,failed)))')
    .order('completed_at', { ascending: true, nullsFirst: false })
    .limit(limit);
  let res = await select('id, reference, status, payout_status, completed_at, payout_due_at');
  if (res.error && /payout_due_at/.test(res.error.message)) res = await select('id, reference, status, payout_status, completed_at');
  if (res.error) throw new Error(`service payout queue: ${res.error.message}`);

  const rows = (res.data ?? []) as unknown as { id: string; reference: string; status: string; payout_status: string | null; completed_at: string | null; payout_due_at?: string | null }[];
  for (const row of rows) {
    if (row.payout_status !== 'processing') {
      const due = row.payout_due_at ? new Date(row.payout_due_at) : row.completed_at ? payoutDueAt(row.completed_at) : null;
      if (!due || due.getTime() > d.now.getTime()) {
        summary.notDue += 1;
        continue;
      }
    }
    summary.considered += 1;
    let r: PayoutResult;
    try {
      r = await triggerCreatorPayout({ bookingId: row.id }, d);
    } catch (err) {
      r = { success: false, outcome: 'error', error: err instanceof Error ? err.message : String(err) };
    }
    summary.outcomes[r.outcome] = (summary.outcomes[r.outcome] ?? 0) + 1;
    if (r.outcome === 'escalated' || r.outcome === 'error') summary.attention.push({ reference: row.reference, why: r.error ?? r.outcome });
    if (r.outcome === 'blocked') summary.held.push({ reference: row.reference, why: r.error ?? 'blocked' });
  }
  return summary;
}
