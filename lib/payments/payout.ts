import { createAdminClient } from '@/lib/supabase/server';
import { initiateTransfer, createTransferRecipient, type TransferRecipientResult } from '@/lib/payments/paystack';
import { verifyPayment } from '@/lib/payments/routing';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

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

interface PayoutResult {
  success: boolean;
  error?: string;
  payoutReference?: string;
}

/** Why a booking may not be paid out, or null when it may. Pure, so it is tested. */
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

/**
 * Pay a creator for a completed service booking, from ThabangVision's balance.
 *
 * Until 2026-09-27 this trusted whatever amount and creator the caller passed
 * and never asked Paystack whether the client had paid, so a booking row with
 * payment_status 'paid' written by anyone was enough to move real money. Now:
 * - the booking, creator and amount are read from the database, never taken
 *   from the caller;
 * - the creator must have passed the ID check (the dashboard and Terms say so);
 * - the booking must be completed and paid, and Paystack must confirm the
 *   payment for at least the booking total;
 * - the payout is claimed atomically (pending/failed -> processing), so two
 *   callers cannot pay twice;
 * - every attempt has its own transfer reference (Paystack refuses a reused
 *   one, which made every retry fail).
 */
export async function triggerCreatorPayout(params: PayoutParams): Promise<PayoutResult> {
  const supabase = createAdminClient();

  const { data: booking, error: readError } = await supabase
    .from('bookings')
    .select('id, reference, paystack_reference, status, payment_status, payout_status, creator_id, creator_amount, total, project_category')
    .eq('id', params.bookingId)
    .single();
  if (readError || !booking) {
    return { success: false, error: `Booking not found: ${readError?.message ?? 'no row'}` };
  }

  const paymentRef = booking.paystack_reference || booking.reference;
  let verified: { success: boolean; amount: number } | null = null;
  try {
    verified = paymentRef ? await verifyPayment(paymentRef) : null;
  } catch (err) {
    console.error('[payout] verify failed:', err);
  }
  const { data: creator } = booking.creator_id
    ? await supabase.from('profiles').select('verification_status').eq('id', booking.creator_id).single()
    : { data: null };
  const blocker = payoutBlocker(booking, verified, creator?.verification_status === 'verified');
  if (blocker) {
    console.error(`[payout] refused for ${booking.reference}: ${blocker}`);
    return { success: false, error: blocker };
  }

  // Claim the payout: only one caller can move it out of pending/failed.
  const payoutRef = `payout-${booking.reference}-${Date.now().toString(36)}`;
  const { data: claimed, error: claimError } = await supabase
    .from('bookings')
    .update({ payout_status: 'processing', payout_reference: payoutRef, updated_at: new Date().toISOString() })
    .eq('id', booking.id)
    .or('payout_status.is.null,payout_status.in.(pending,failed)')
    .select('id');
  if (claimError || !claimed || claimed.length === 0) {
    return { success: false, error: claimError ? claimError.message : 'Payout already started by another process' };
  }

  const { data: banking } = await supabase
    .from('banking_details')
    .select('paystack_recipient_code, account_holder')
    .eq('user_id', booking.creator_id)
    .single();

  const fail = async (error: string): Promise<PayoutResult> => {
    await supabase
      .from('bookings')
      .update({ payout_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', booking.id);
    return { success: false, error };
  };

  if (!banking?.paystack_recipient_code) {
    return fail('Creator has no Paystack recipient code');
  }

  try {
    const result = await initiateTransfer({
      amount: booking.creator_amount,
      recipientCode: banking.paystack_recipient_code,
      reason: `Gig payout: ${booking.project_category} (${booking.reference})`,
      reference: payoutRef,
    });

    if (!result.success) {
      return fail(result.error || 'Transfer initiation failed');
    }

    try {
      await supabase.from('notifications').insert({
        user_id: booking.creator_id,
        type: 'payout_processing',
        title: 'Payout Processing',
        body: `Your payout of R${booking.creator_amount} for ${booking.project_category} (${booking.reference}) is being processed.`,
        link: '/dashboard/gigs',
      });

      const { data: authUser } = await supabase.auth.admin.getUserById(booking.creator_id);
      if (authUser?.user?.email) {
        await emailProvider.sendEmail({
          to: authUser.user.email,
          subject: `Payout Processing — ${STUDIO.name}`,
          text: `Hi ${banking.account_holder},\n\nYour payout of R${booking.creator_amount} for the ${booking.project_category} gig (${booking.reference}) is being processed.\n\nThis should reflect in your bank account within 1-2 business days.\n\nThank you,\n${STUDIO.name}`,
        });
      }
    } catch { /* don't block */ }

    return { success: true, payoutReference: payoutRef };
  } catch (err) {
    console.error('[payout] Unexpected error:', err);
    return fail('Unexpected payout error');
  }
}
