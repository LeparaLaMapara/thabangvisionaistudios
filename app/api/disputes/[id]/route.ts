export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — Get dispute details with comments ────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const supabase = createAdminClient();
    const userIsAdmin = await isAdmin(auth.user.id, auth.user.email);

    // Fetch dispute
    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('*')
      .eq('id', id)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 });
    }

    // Verify user is a party to the dispute (or admin)
    if (!userIsAdmin) {
      let isParty = dispute.filed_by === auth.user.id;

      if (!isParty && dispute.booking_id) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('client_id, creator_id')
          .eq('id', dispute.booking_id)
          .single();
        if (booking) {
          isParty = booking.client_id === auth.user.id || booking.creator_id === auth.user.id;
        }
      }

      if (!isParty && dispute.equipment_booking_id) {
        const { data: eb } = await supabase
          .from('equipment_bookings')
          .select('user_id, rental_id')
          .eq('id', dispute.equipment_booking_id)
          .single();
        if (eb) {
          if (eb.user_id === auth.user.id) {
            isParty = true;
          } else {
            const { data: rental } = await supabase
              .from('smart_rentals')
              .select('owner_id')
              .eq('id', eb.rental_id)
              .single();
            if (rental?.owner_id === auth.user.id) isParty = true;
          }
        }
      }

      if (!isParty) {
        return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
      }
    }

    // Fetch comments (exclude internal unless admin)
    const commentsQuery = supabase
      .from('dispute_comments')
      .select('*')
      .eq('dispute_id', id)
      .order('created_at', { ascending: true });

    if (!userIsAdmin) {
      commentsQuery.eq('is_internal', false);
    }

    const { data: comments } = await commentsQuery;

    return NextResponse.json({
      ...dispute,
      comments: comments ?? [],
    });
  } catch (err) {
    console.error('[disputes/[id]] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
