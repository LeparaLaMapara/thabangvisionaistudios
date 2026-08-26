export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { refundPayment } from '@/lib/payments/paystack';

type DepositAction = 'full_release' | 'partial_release' | 'no_release' | 'dispute';

const VALID_ACTIONS: DepositAction[] = [
  'full_release',
  'partial_release',
  'no_release',
  'dispute',
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const limited = rateLimitAdmin(auth.user.id, 'sensitive');
    if (limited) return limited;
    const { id } = await params;

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || !('deposit_action' in body)) {
      return NextResponse.json(
        { error: 'Missing required field: deposit_action' },
        { status: 400 },
      );
    }

    const {
      deposit_action,
      deposit_release_amount,
      admin_notes,
    } = body as {
      deposit_action: string;
      deposit_release_amount?: number;
      admin_notes?: string;
    };

    if (!VALID_ACTIONS.includes(deposit_action as DepositAction)) {
      return NextResponse.json(
        { error: `Invalid deposit_action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 },
      );
    }

    if (
      deposit_action === 'partial_release' &&
      (typeof deposit_release_amount !== 'number' || deposit_release_amount <= 0)
    ) {
      return NextResponse.json(
        { error: 'deposit_release_amount is required and must be > 0 for partial_release' },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from('equipment_bookings')
      .select('id, user_id, status, deposit_amount, payfast_payment_id, late_fee, notes')
      .eq('id', id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 },
      );
    }

    if (booking.status !== 'return_pending') {
      return NextResponse.json(
        { error: `Booking must be in "return_pending" status to review. Current status: ${booking.status}` },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const depositAmount = booking.deposit_amount ?? 0;
    let depositReleased = 0;
    let newStatus: string;

    if (deposit_action === 'dispute') {
      newStatus = 'disputed';
      depositReleased = 0;
    } else {
      newStatus = 'completed';

      if (deposit_action === 'full_release') {
        depositReleased = depositAmount;
      } else if (deposit_action === 'partial_release') {
        depositReleased = Math.min(deposit_release_amount!, depositAmount);
      }
      // no_release: depositReleased stays 0

      // Process refund via Paystack if there's an amount to release
      if (depositReleased > 0 && booking.payfast_payment_id) {
        const refundResult = await refundPayment(
          booking.payfast_payment_id,
          depositReleased,
        );

        if (!refundResult.success) {
          console.error('[review-return] Refund failed:', refundResult.error);
          return NextResponse.json(
            { error: `Deposit refund failed: ${refundResult.error}` },
            { status: 500 },
          );
        }
      }
    }

    // Build notes with admin notes appended
    const updatedNotes = admin_notes
      ? `${booking.notes ? booking.notes + '\n' : ''}[Admin Review] ${admin_notes}`
      : booking.notes;

    const { error: updateError } = await supabase
      .from('equipment_bookings')
      .update({
        status: newStatus,
        deposit_released: depositReleased,
        deposit_released_at: depositReleased > 0 ? now : null,
        return_reviewed_by: auth.user.id,
        return_reviewed_at: now,
        notes: updatedNotes,
        updated_at: now,
      })
      .eq('id', id);

    if (updateError) {
      console.error('[review-return] Update failed:', updateError);
      return NextResponse.json(
        { error: 'Failed to update booking' },
        { status: 500 },
      );
    }

    // Notify the renter
    try {
      const notifBody =
        deposit_action === 'dispute'
          ? 'Your gear return is under dispute. Our team will contact you.'
          : depositReleased > 0
            ? `Your gear return has been reviewed. R${depositReleased.toFixed(2)} deposit has been released.`
            : 'Your gear return has been reviewed. No deposit was released due to condition issues or fees.';

      await supabase.from('notifications').insert({
        user_id: booking.user_id,
        type: 'rental_return_reviewed',
        title: deposit_action === 'dispute' ? 'Return Disputed' : 'Return Reviewed',
        body: notifBody,
        link: `/dashboard/bookings/${id}`,
      });
    } catch {
      // Don't block the review on notification failure
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      deposit_released: depositReleased,
    });
  } catch (err) {
    console.error('[review-return] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
