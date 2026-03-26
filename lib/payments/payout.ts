import { createAdminClient } from '@/lib/supabase/server';
import { initiateTransfer } from '@/lib/payments/paystack';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

interface PayoutParams {
  bookingId: string;
  reference: string;
  creatorId: string;
  creatorAmount: number;
  projectCategory: string;
}

interface PayoutResult {
  success: boolean;
  error?: string;
  payoutReference?: string;
}

/**
 * Triggers a Paystack transfer to the creator for a completed booking.
 * Used by both auto-payout (on client approval) and admin manual payout.
 */
export async function triggerCreatorPayout(params: PayoutParams): Promise<PayoutResult> {
  const { bookingId, reference, creatorId, creatorAmount, projectCategory } = params;
  const supabase = createAdminClient();

  // Get creator's banking details
  const { data: banking } = await supabase
    .from('banking_details')
    .select('paystack_recipient_code, account_holder')
    .eq('user_id', creatorId)
    .single();

  if (!banking?.paystack_recipient_code) {
    // Mark payout as failed, notify admin
    await supabase
      .from('bookings')
      .update({ payout_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', bookingId);

    return { success: false, error: 'Creator has no Paystack recipient code' };
  }

  const payoutRef = `payout-${reference}`;

  try {
    const result = await initiateTransfer({
      amount: creatorAmount,
      recipientCode: banking.paystack_recipient_code,
      reason: `Gig payout: ${projectCategory} (${reference})`,
      reference: payoutRef,
    });

    if (!result.success) {
      await supabase
        .from('bookings')
        .update({ payout_status: 'failed', payout_reference: payoutRef, updated_at: new Date().toISOString() })
        .eq('id', bookingId);

      return { success: false, error: result.error || 'Transfer initiation failed' };
    }

    // Update booking to processing
    await supabase
      .from('bookings')
      .update({
        payout_status: 'processing',
        payout_reference: payoutRef,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    // Notify creator
    try {
      await supabase.from('notifications').insert({
        user_id: creatorId,
        type: 'payout_processing',
        title: 'Payout Processing',
        body: `Your payout of R${creatorAmount} for ${projectCategory} (${reference}) is being processed.`,
        link: '/dashboard/gigs',
      });

      const { data: authUser } = await supabase.auth.admin.getUserById(creatorId);
      if (authUser?.user?.email) {
        await emailProvider.sendEmail({
          to: authUser.user.email,
          subject: `Payout Processing — ${STUDIO.name}`,
          text: `Hi ${banking.account_holder},\n\nYour payout of R${creatorAmount} for the ${projectCategory} gig (${reference}) is being processed.\n\nThis should reflect in your bank account within 1-2 business days.\n\nThank you,\n${STUDIO.name}`,
        });
      }
    } catch { /* don't block */ }

    return { success: true, payoutReference: payoutRef };
  } catch (err) {
    console.error('[payout] Unexpected error:', err);

    await supabase
      .from('bookings')
      .update({ payout_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', bookingId);

    return { success: false, error: 'Unexpected payout error' };
  }
}
