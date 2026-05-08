export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { triggerCreatorPayout } from '@/lib/payments/payout';

// ─── POST — Trigger creator payout (admin only, after completion) ────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

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

  const result = await triggerCreatorPayout({
    bookingId: booking.id,
    reference: booking.reference,
    creatorId: booking.creator_id,
    creatorAmount: booking.creator_amount,
    projectCategory: booking.project_category,
  });

  if (!result.success) {
    return NextResponse.json({ error: `Payout failed: ${result.error}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, payout_reference: result.payoutReference });
}
