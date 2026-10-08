import { createAdminClient } from '@/lib/supabase/server';

/**
 * Transfer events for creator payouts on SERVICE bookings (the `bookings`
 * table). Moved here unchanged from the Paystack webhook route so the
 * payment inbox can call it; gear owner payouts use owner_payouts instead
 * (lib/core/rental/payouts.ts).
 */

export async function handleServiceTransferEvent(event: string, reference: string): Promise<void> {
  if (event === 'transfer.success') await handleTransferSuccess({ reference });
  else if (event === 'transfer.failed' || event === 'transfer.reversed') await handleTransferFailed({ reference });
}

async function handleTransferSuccess(raw: Record<string, unknown>) {
  const reference = (raw.reference as string) || '';
  if (!reference) return;

  console.log(`[paystack-webhook] TRANSFER SUCCESS: ref=${reference}`);

  const supabase = createAdminClient();

  // Idempotency: skip if already paid out
  const { data: existing } = await supabase
    .from('bookings')
    .select('id, payout_status')
    .eq('payout_reference', reference)
    .single();

  if (existing?.payout_status === 'paid') {
    console.log(`[paystack-webhook] Transfer already processed: ref=${reference}`);
    return;
  }

  const now = new Date().toISOString();

  const { data: booking, error: updateError } = await supabase
    .from('bookings')
    .update({
      payout_status: 'paid',
      status: 'paid_out',
      paid_out_at: now,
      updated_at: now,
    })
    .eq('payout_reference', reference)
    .select('id, reference, creator_id, creator_amount, project_category')
    .single();

  if (updateError) {
    console.error('[paystack-webhook] Transfer success update failed:', updateError.message);
    return;
  }

  // Notify creator
  if (booking?.creator_id) {
    try {
      await supabase.from('notifications').insert({
        user_id: booking.creator_id,
        type: 'payout_complete',
        title: 'Payout Complete',
        body: `R${booking.creator_amount} has been transferred to your bank account for ${booking.project_category} (${booking.reference}).`,
        link: '/dashboard/gigs',
      });
    } catch { /* don't block */ }
  }
}

async function handleTransferFailed(raw: Record<string, unknown>) {
  const reference = (raw.reference as string) || '';
  if (!reference) return;

  console.error(`[paystack-webhook] TRANSFER FAILED: ref=${reference}`);

  const supabase = createAdminClient();

  // Idempotency: skip if already paid (success arrived first) or already marked failed
  const { data: existing } = await supabase
    .from('bookings')
    .select('id, payout_status')
    .eq('payout_reference', reference)
    .single();

  if (existing?.payout_status === 'paid' || existing?.payout_status === 'failed') {
    console.log(`[paystack-webhook] Transfer already processed (${existing.payout_status}): ref=${reference}`);
    return;
  }

  const { error } = await supabase
    .from('bookings')
    .update({
      payout_status: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('payout_reference', reference);

  if (error) {
    console.error('[paystack-webhook] Transfer failed update error:', error.message);
  }
}
