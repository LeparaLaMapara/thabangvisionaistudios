export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

const VALID_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireAdmin();
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

    const { condition, photos } = body as {
      condition: string;
      photos: string[];
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

    // Verify booking exists and is in correct status
    const { data: booking, error: fetchError } = await supabase
      .from('equipment_bookings')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 },
      );
    }

    if (booking.status !== 'confirmed') {
      return NextResponse.json(
        { error: `Booking must be in "confirmed" status to record checkout condition. Current status: ${booking.status}` },
        { status: 400 },
      );
    }

    const { error: updateError } = await supabase
      .from('equipment_bookings')
      .update({
        condition_at_checkout: condition,
        checkout_photos: photos,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[checkout-condition] Update failed:', updateError);
      return NextResponse.json(
        { error: 'Failed to update booking' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[checkout-condition] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
