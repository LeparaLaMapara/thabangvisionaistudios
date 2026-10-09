export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { triggerCreatorPayout, type PayoutOutcome } from '@/lib/payments/payout';
import { recordServiceBookingEvent } from '@/lib/supabase/queries/service-bookings';

// ─── POST — Send or reconcile a creator payout (admin only) ──────────────────
//
// Same rules as the daily job (lib/payments/payout.ts): the booking must be
// completed, paid and provider-confirmed, the payout due, no dispute open,
// and the creator verified with a validated bank account. A payout already
// with the provider is looked up by its stable reference, never re-sent under
// a new one. An admin cannot skip the rules here; a payout that needs an
// exception is made by hand in the provider dashboard and recorded.

const STATUS_FOR: Record<PayoutOutcome, number> = {
  sent: 200,
  reconciled_paid: 200,
  already_paid: 409,
  in_flight: 409,
  blocked: 400,
  escalated: 409,
  retry_later: 503,
  error: 502,
};

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

  const supabase = createAdminClient();

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, status, payout_status')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.payout_status === 'paid') {
    return NextResponse.json({ error: 'Payout already completed' }, { status: 409 });
  }

  const result = await triggerCreatorPayout({ bookingId: booking.id });

  await recordServiceBookingEvent(supabase, {
    bookingId: booking.id,
    event: 'admin_payout',
    from: booking.status,
    to: booking.status,
    actor: 'admin',
    actorId: auth.user.id,
    reason: `${result.outcome}${result.error ? `: ${result.error}` : ''}`,
  });

  if (!result.success) {
    return NextResponse.json(
      { error: `Payout not sent: ${result.error ?? result.outcome}`, outcome: result.outcome, reasons: result.reasons ?? [] },
      { status: STATUS_FOR[result.outcome] },
    );
  }

  return NextResponse.json({ success: true, outcome: result.outcome, payout_reference: result.payoutReference });
}
