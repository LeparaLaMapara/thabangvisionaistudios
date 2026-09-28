export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { RENTAL_POLICIES } from '@/lib/constants';
import { startOfBookedDay } from '@/lib/rental/cancellation';

const VALID_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { id } = await params;

    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('condition' in body) ||
      !('photos' in body)
    ) {
      return NextResponse.json(
        { error: 'Missing required fields: condition, photos' },
        { status: 400 },
      );
    }

    const { condition, photos, notes } = body as {
      condition: string;
      photos: string[];
      notes?: string;
    };

    if (!VALID_CONDITIONS.includes(condition as typeof VALID_CONDITIONS[number])) {
      return NextResponse.json(
        { error: `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}` },
        { status: 400 },
      );
    }

    if (!Array.isArray(photos)) {
      return NextResponse.json(
        { error: 'photos must be an array of URLs' },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // Verify booking exists, user owns it, and status is correct
    const { data: booking, error: fetchError } = await supabase
      .from('equipment_bookings')
      .select('id, user_id, status, end_date, deposit_amount')
      .eq('id', id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 },
      );
    }

    if (booking.user_id !== auth.user.id) {
      return NextResponse.json(
        { error: 'You do not own this booking' },
        { status: 403 },
      );
    }

    if (booking.status !== 'active' && booking.status !== 'overdue') {
      return NextResponse.json(
        { error: `Booking must be in "active" or "overdue" status to initiate return. Current status: ${booking.status}` },
        { status: 400 },
      );
    }

    // Calculate late fee if overdue
    let lateFee = 0;
    const now = new Date();
    // Late only once the return day is over (midnight South African time).
    // Counting from the start of the return day charged gear handed back on
    // the due date a full day's late fee.
    const msPerDay = 24 * 60 * 60 * 1000;
    const lateFrom = new Date(startOfBookedDay(booking.end_date).getTime() + msPerDay);
    if (now > lateFrom) {
      const daysLate = Math.ceil((now.getTime() - lateFrom.getTime()) / msPerDay);
      const cappedDays = Math.min(daysLate, RENTAL_POLICIES.maxLateDays);
      lateFee = Math.min(
        cappedDays * RENTAL_POLICIES.lateFeePerDayZar,
        booking.deposit_amount ?? 0,
      );
    }

    const { error: updateError } = await supabase
      .from('equipment_bookings')
      .update({
        condition_at_return: condition,
        return_photos: photos,
        return_notes: notes ?? null,
        returned_at: now.toISOString(),
        late_fee: lateFee,
        status: 'return_pending',
        updated_at: now.toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[return] Update failed:', updateError);
      return NextResponse.json(
        { error: 'Failed to update booking' },
        { status: 500 },
      );
    }

    // Notify admins about the return
    try {
      // Get admin user IDs from profiles
      const { data: adminProfiles } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

      for (const admin of adminProfiles ?? []) {
        await supabase.from('notifications').insert({
          user_id: admin.id,
          type: 'rental_return_pending',
          title: 'Gear return submitted',
          body: `A renter has submitted a gear return for booking ${id}. Please review.`,
          link: `/admin/rentals/${id}/review-return`,
        });
      }
    } catch {
      // Don't block the return on notification failure
    }

    return NextResponse.json({ success: true, late_fee: lateFee });
  } catch (err) {
    console.error('[return] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
