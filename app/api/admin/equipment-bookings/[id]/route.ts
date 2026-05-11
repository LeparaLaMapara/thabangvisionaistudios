export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── Valid status transitions for equipment bookings ────────────────────────

const VALID_STATUSES = ['confirmed', 'cancelled', 'active', 'returned', 'completed'] as const;
type AdminUpdateStatus = (typeof VALID_STATUSES)[number];

// ─── PATCH — Admin update equipment booking status ──────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  const supabase = createAdminClient();

  // Validate request body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { status } = body as { status?: string };

  if (!status) {
    return NextResponse.json(
      { error: 'status is required' },
      { status: 400 },
    );
  }

  if (!VALID_STATUSES.includes(status as AdminUpdateStatus)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  // Verify booking exists
  const { data: booking, error: fetchError } = await supabase
    .from('equipment_bookings')
    .select('id, status')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // Build update payload
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'cancelled') {
    update.cancelled_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from('equipment_bookings')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    console.error('[admin/equipment-bookings] PATCH error:', updateError.message);
    return NextResponse.json(
      { error: 'Failed to update booking' },
      { status: 500 },
    );
  }

  return NextResponse.json(updated);
}
