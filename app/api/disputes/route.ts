export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkNotSuspended } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sendDisputeFiled } from '@/lib/email';

const VALID_DISPUTE_TYPES = [
  'gear_damage',
  'gear_not_returned',
  'creator_no_show',
  'client_cancellation',
  'quality_dispute',
  'payment_dispute',
] as const;

type DisputeType = (typeof VALID_DISPUTE_TYPES)[number];

// ─── POST — File a new dispute ──────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const suspendCheck = await checkNotSuspended(auth.user.id);
  if (suspendCheck.suspended) {
    return NextResponse.json(
      { error: `Account suspended: ${suspendCheck.reason ?? 'Contact support.'}` },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const {
    dispute_type,
    booking_id,
    equipment_booking_id,
    reason,
    evidence_photos,
    evidence_notes,
  } = body as {
    dispute_type?: string;
    booking_id?: string;
    equipment_booking_id?: string;
    reason?: string;
    evidence_photos?: string[];
    evidence_notes?: string;
  };

  // Validate required fields
  if (!dispute_type || !VALID_DISPUTE_TYPES.includes(dispute_type as DisputeType)) {
    return NextResponse.json(
      { error: `Invalid dispute_type. Must be one of: ${VALID_DISPUTE_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    return NextResponse.json(
      { error: 'Reason is required and must be at least 10 characters.' },
      { status: 400 },
    );
  }
  if (!booking_id && !equipment_booking_id) {
    return NextResponse.json(
      { error: 'Either booking_id or equipment_booking_id is required.' },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();

    // Validate user is party to the booking
    if (equipment_booking_id) {
      const { data: eb, error: ebErr } = await supabase
        .from('equipment_bookings')
        .select('id, user_id, status, rental_id')
        .eq('id', equipment_booking_id)
        .single();

      if (ebErr || !eb) {
        return NextResponse.json({ error: 'Equipment booking not found.' }, { status: 404 });
      }
      if (eb.user_id !== auth.user.id) {
        // Also check if user owns the rental
        const { data: rental } = await supabase
          .from('smart_rentals')
          .select('owner_id')
          .eq('id', eb.rental_id)
          .single();
        if (!rental || rental.owner_id !== auth.user.id) {
          return NextResponse.json({ error: 'You are not a party to this booking.' }, { status: 403 });
        }
      }
      if (['cancelled', 'disputed'].includes(eb.status)) {
        return NextResponse.json({ error: 'This booking is not in a disputable state.' }, { status: 400 });
      }
    }

    if (booking_id) {
      const { data: bk, error: bkErr } = await supabase
        .from('bookings')
        .select('id, client_id, creator_id, status')
        .eq('id', booking_id)
        .single();

      if (bkErr || !bk) {
        return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
      }
      if (bk.client_id !== auth.user.id && bk.creator_id !== auth.user.id) {
        return NextResponse.json({ error: 'You are not a party to this booking.' }, { status: 403 });
      }
      if (['cancelled', 'disputed'].includes(bk.status)) {
        return NextResponse.json({ error: 'This booking is not in a disputable state.' }, { status: 400 });
      }
    }

    // Check for duplicate open disputes
    const duplicateQuery = adminClient
      .from('disputes')
      .select('id')
      .eq('filed_by', auth.user.id)
      .in('status', ['open', 'investigating']);

    if (equipment_booking_id) {
      duplicateQuery.eq('equipment_booking_id', equipment_booking_id);
    }
    if (booking_id) {
      duplicateQuery.eq('booking_id', booking_id);
    }

    const { data: existing } = await duplicateQuery.maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: 'You already have an open dispute for this booking.' },
        { status: 409 },
      );
    }

    // Create dispute record
    const { data: dispute, error: insertError } = await adminClient
      .from('disputes')
      .insert({
        dispute_type,
        booking_id: booking_id || null,
        equipment_booking_id: equipment_booking_id || null,
        filed_by: auth.user.id,
        reason: reason.trim(),
        evidence_photos: evidence_photos ?? [],
        evidence_notes: evidence_notes?.trim() || null,
        status: 'open',
      })
      .select('id')
      .single();

    if (insertError || !dispute) {
      console.error('[disputes] Insert error:', insertError?.message);
      return NextResponse.json({ error: 'Failed to file dispute.' }, { status: 500 });
    }

    // Update booking status to 'disputed'
    const now = new Date().toISOString();
    if (equipment_booking_id) {
      await adminClient
        .from('equipment_bookings')
        .update({
          status: 'disputed',
          dispute_reason: reason.trim(),
          disputed_at: now,
          updated_at: now,
        })
        .eq('id', equipment_booking_id);
    }
    if (booking_id) {
      await adminClient
        .from('bookings')
        .update({
          status: 'disputed',
          dispute_reason: reason.trim(),
          disputed_at: now,
          updated_at: now,
        })
        .eq('id', booking_id);
    }

    // Notify admin
    try {
      // Find an admin user to notify (first admin email in profiles)
      const { data: adminProfiles } = await adminClient
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .limit(5);

      for (const admin of adminProfiles ?? []) {
        await adminClient.from('notifications').insert({
          user_id: admin.id,
          type: 'dispute_filed',
          title: 'New Dispute Filed',
          body: `A ${dispute_type.replace(/_/g, ' ')} dispute has been filed. Review required.`,
          link: `/admin/disputes/${dispute.id}`,
        });
      }
    } catch {
      // Don't block on notification failure
    }

    // Send dispute filed emails
    try {
      const { data: filerProfile } = await adminClient
        .from('profiles')
        .select('email, display_name')
        .eq('id', auth.user.id)
        .single();

      if (filerProfile?.email) {
        await sendDisputeFiled({
          email: filerProfile.email,
          displayName: filerProfile.display_name || '',
          disputeType: dispute_type,
          disputeId: dispute.id,
          role: 'filer',
        });
      }
    } catch {
      // Email failure shouldn't block
    }

    return NextResponse.json({ id: dispute.id }, { status: 201 });
  } catch (err) {
    console.error('[disputes] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ─── GET — List user's disputes ─────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const adminClient = createAdminClient();

    // Get disputes filed by user
    const { data: filedDisputes } = await adminClient
      .from('disputes')
      .select('*')
      .eq('filed_by', auth.user.id)
      .order('created_at', { ascending: false });

    // Get disputes on bookings where user is the other party
    const { data: userBookings } = await adminClient
      .from('bookings')
      .select('id')
      .or(`client_id.eq.${auth.user.id},creator_id.eq.${auth.user.id}`);

    const { data: userEquipBookings } = await adminClient
      .from('equipment_bookings')
      .select('id')
      .eq('user_id', auth.user.id);

    const bookingIds = (userBookings ?? []).map((b) => b.id);
    const equipBookingIds = (userEquipBookings ?? []).map((b) => b.id);

    let relatedDisputes: unknown[] = [];
    if (bookingIds.length > 0 || equipBookingIds.length > 0) {
      const orClauses: string[] = [];
      if (bookingIds.length > 0) {
        orClauses.push(`booking_id.in.(${bookingIds.join(',')})`);
      }
      if (equipBookingIds.length > 0) {
        orClauses.push(`equipment_booking_id.in.(${equipBookingIds.join(',')})`);
      }

      const { data } = await adminClient
        .from('disputes')
        .select('*')
        .neq('filed_by', auth.user.id)
        .or(orClauses.join(','))
        .order('created_at', { ascending: false });

      relatedDisputes = data ?? [];
    }

    // Merge and deduplicate
    const allDisputes = [...(filedDisputes ?? []), ...relatedDisputes];
    const seen = new Set<string>();
    const unique = allDisputes.filter((d) => {
      const dispute = d as { id: string };
      if (seen.has(dispute.id)) return false;
      seen.add(dispute.id);
      return true;
    });

    return NextResponse.json(unique);
  } catch (err) {
    console.error('[disputes] GET error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
