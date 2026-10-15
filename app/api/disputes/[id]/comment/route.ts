export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAdmin, checkRateLimit, checkNotSuspended } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { REPORT_MAX_CHARS, evidencePhotoList } from '@/lib/disputes/report';

/** A dispute still being worked on; comments on a closed one are refused (staff excepted). */
const LIVE_DISPUTE_STATUSES = ['open', 'investigating', 'escalated'];

// ─── POST — Add a comment to a dispute ──────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: disputeId } = await params;
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { comment, attachments, is_internal } = body as {
    comment?: string;
    attachments?: string[];
    is_internal?: boolean;
  };

  if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
    return NextResponse.json({ error: 'Comment is required.' }, { status: 400 });
  }
  if (comment.length > REPORT_MAX_CHARS) {
    return NextResponse.json({ error: `Keep the comment under ${REPORT_MAX_CHARS} characters.` }, { status: 400 });
  }
  // Attachments are shown to staff and the other party as links and images:
  // our own Cloudinary images only (security re-check 2026-10-15, M6).
  const photos = evidencePhotoList(attachments);
  if (photos === null) {
    return NextResponse.json({ error: 'Attachments must be photos uploaded here.' }, { status: 400 });
  }
  if (!(await checkRateLimit(`dispute-comment:${auth.user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many comments. Wait a moment.' }, { status: 429 });
  }
  const suspendCheck = await checkNotSuspended(auth.user.id);
  if (suspendCheck.suspended) {
    return NextResponse.json({ error: 'Your account is suspended.' }, { status: 403 });
  }

  try {
    const supabase = createAdminClient();
    const userIsAdmin = await isAdmin(auth.user.id, auth.user.email);

    // Fetch dispute to verify access
    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('id, filed_by, booking_id, equipment_booking_id, status')
      .eq('id', disputeId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 });
    }

    // Verify user is party or admin
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
      if (!LIVE_DISPUTE_STATUSES.includes(String(dispute.status))) {
        return NextResponse.json({ error: 'This dispute is closed.' }, { status: 409 });
      }
    }

    // Only admins can post internal comments
    const internal = userIsAdmin && is_internal === true;

    // Insert comment
    const { data: newComment, error: insertError } = await supabase
      .from('dispute_comments')
      .insert({
        dispute_id: disputeId,
        author_id: auth.user.id,
        comment: comment.trim(),
        attachments: photos,
        is_internal: internal,
      })
      .select('id')
      .single();

    if (insertError || !newComment) {
      console.error('[disputes/comment] Insert error:', insertError?.message);
      return NextResponse.json({ error: 'Failed to add comment.' }, { status: 500 });
    }

    // Notify other party (skip for internal admin notes)
    if (!internal) {
      try {
        const notifyTargets: string[] = [];

        // Notify filer if commenter is not the filer
        if (dispute.filed_by !== auth.user.id) {
          notifyTargets.push(dispute.filed_by);
        }

        // Notify other booking party
        if (dispute.booking_id) {
          const { data: booking } = await supabase
            .from('bookings')
            .select('client_id, creator_id')
            .eq('id', dispute.booking_id)
            .single();
          if (booking) {
            if (booking.client_id && booking.client_id !== auth.user.id) {
              notifyTargets.push(booking.client_id);
            }
            if (booking.creator_id && booking.creator_id !== auth.user.id) {
              notifyTargets.push(booking.creator_id);
            }
          }
        }

        if (dispute.equipment_booking_id) {
          const { data: eb } = await supabase
            .from('equipment_bookings')
            .select('user_id, rental_id')
            .eq('id', dispute.equipment_booking_id)
            .single();
          if (eb) {
            if (eb.user_id !== auth.user.id) notifyTargets.push(eb.user_id);
            const { data: rental } = await supabase
              .from('smart_rentals')
              .select('owner_id')
              .eq('id', eb.rental_id)
              .single();
            if (rental?.owner_id && rental.owner_id !== auth.user.id) {
              notifyTargets.push(rental.owner_id);
            }
          }
        }

        const uniqueTargets = [...new Set(notifyTargets)];
        for (const targetId of uniqueTargets) {
          await supabase.from('notifications').insert({
            user_id: targetId,
            type: 'dispute_comment',
            title: 'New Comment on Dispute',
            body: 'A new comment has been added to your dispute.',
            link: `/dashboard/disputes/${disputeId}`,
          });
        }
      } catch {
        // Don't block on notification failure
      }
    }

    return NextResponse.json({ id: newComment.id }, { status: 201 });
  } catch (err) {
    console.error('[disputes/comment] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
