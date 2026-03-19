export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { initiateTransfer } from '@/lib/payments/paystack';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

// ─── POST — Trigger creator payout (admin only, after completion) ────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabase = createAdminClient();

  // Fetch booking
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, reference, creator_id, project_category, status, creator_amount, payout_status, payment_status')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.status !== 'completed') {
    return NextResponse.json({ error: 'Can only trigger payout for completed bookings' }, { status: 400 });
  }

  if (booking.payment_status !== 'paid') {
    return NextResponse.json({ error: 'Booking has not been paid' }, { status: 400 });
  }

  if (booking.payout_status === 'paid') {
    return NextResponse.json({ error: 'Payout already completed' }, { status: 409 });
  }

  if (booking.payout_status === 'processing') {
    return NextResponse.json({ error: 'Payout is already processing' }, { status: 409 });
  }

  if (!booking.creator_id) {
    return NextResponse.json({ error: 'No creator assigned to this booking' }, { status: 400 });
  }

  // Get creator's banking details
  const { data: banking } = await supabase
    .from('banking_details')
    .select('paystack_recipient_code, account_holder')
    .eq('user_id', booking.creator_id)
    .single();

  if (!banking?.paystack_recipient_code) {
    return NextResponse.json({ error: 'Creator has no Paystack recipient code. Ensure banking details are saved.' }, { status: 400 });
  }

  // Initiate transfer
  const payoutRef = `payout-${booking.reference}`;
  const result = await initiateTransfer({
    amount: booking.creator_amount,
    recipientCode: banking.paystack_recipient_code,
    reason: `Gig payout: ${booking.project_category} (${booking.reference})`,
    reference: payoutRef,
  });

  if (!result.success) {
    console.error('[admin/payout] Transfer failed:', result.error);
    return NextResponse.json({ error: `Payout failed: ${result.error}` }, { status: 500 });
  }

  // Update booking payout status
  await supabase
    .from('bookings')
    .update({
      payout_status: 'processing',
      payout_reference: payoutRef,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  // Notify creator
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

  return NextResponse.json({ success: true, payout_reference: payoutRef });
}
