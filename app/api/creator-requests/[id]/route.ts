export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit } from '@/lib/auth';

// Writes that touch money or status go through the service role, after the
// route has checked who the user is and that the record is theirs. The users'
// own sessions may only read these tables (see the RLS migration of 2026-09-27).
const admin = () => createAdminClient();

// Allowed status transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'declined', 'cancelled'],
  confirmed: ['completed', 'paid'],
  paid: ['in_progress'],
  in_progress: ['completed'],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 10 status updates per minute per user
  if (!(await checkRateLimit(`crew-request:${user.id}`, 10, 60_000))) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  const body = await request.json();
  const { status } = body;

  if (!status || typeof status !== 'string') {
    return NextResponse.json({ error: 'Status is required' }, { status: 400 });
  }

  // Fetch the request
  const { data: crewRequest, error: fetchError } = await supabase
    .from('crew_requests')
    .select('id, creator_id, client_email, client_name, project_type, status, deposit_amount, total_amount, quoted_rate, estimated_hours')
    .eq('id', id)
    .single();

  if (fetchError || !crewRequest) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  // Auth check: creator can update their own gigs, client can only cancel pending
  const isCreator = crewRequest.creator_id === user.id;
  const isClient = user.email === crewRequest.client_email;

  if (!isCreator && !isClient) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Client can only cancel their own pending requests
  if (isClient && !isCreator) {
    if (status !== 'cancelled' || crewRequest.status !== 'pending') {
      return NextResponse.json(
        { error: 'You can only cancel pending requests' },
        { status: 403 },
      );
    }
  }

  // Validate transition
  const allowed = ALLOWED_TRANSITIONS[crewRequest.status];
  if (!allowed || !allowed.includes(status)) {
    return NextResponse.json(
      { error: `Cannot transition from '${crewRequest.status}' to '${status}'` },
      { status: 400 },
    );
  }

  // Single active gig constraint: creator cannot accept if they have an active gig
  if (isCreator && status === 'confirmed') {
    const { data: activeGigs } = await supabase
      .from('crew_requests')
      .select('id')
      .eq('creator_id', user.id)
      .in('status', ['confirmed', 'paid', 'in_progress'])
      .limit(1);

    if (activeGigs && activeGigs.length > 0) {
      return NextResponse.json(
        { error: 'You already have an active gig. Complete or finish your current gig before accepting a new one.' },
        { status: 409 },
      );
    }
  }

  // Update status
  const { error: updateError } = await admin()
    .from('crew_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) {
    console.error('[creator-requests/[id]] PATCH error:', updateError.message);
    return NextResponse.json({ error: 'Failed to update request' }, { status: 500 });
  }

  // Insert notification for the creator
  try {
    if (status === 'cancelled') {
      await admin().from('notifications').insert({
        user_id: crewRequest.creator_id,
        type: 'gig_cancelled',
        title: 'Gig Request Cancelled',
        body: `A ${crewRequest.project_type} request from ${crewRequest.client_name} has been cancelled.`,
        link: '/dashboard/gigs',
      });
    } else if (status === 'confirmed') {
      await admin().from('notifications').insert({
        user_id: crewRequest.creator_id,
        type: 'gig_confirmed',
        title: 'Gig Confirmed',
        body: `Your ${crewRequest.project_type} gig for ${crewRequest.client_name} is confirmed.`,
        link: '/dashboard/gigs',
      });
    } else if (status === 'declined') {
      await admin().from('notifications').insert({
        user_id: crewRequest.creator_id,
        type: 'gig_declined',
        title: 'Gig Declined',
        body: `The ${crewRequest.project_type} gig for ${crewRequest.client_name} was declined.`,
        link: '/dashboard/gigs',
      });
    } else if (status === 'completed') {
      await admin().from('notifications').insert({
        user_id: crewRequest.creator_id,
        type: 'gig_completed',
        title: 'Gig Completed',
        body: `Your ${crewRequest.project_type} gig for ${crewRequest.client_name} is now complete.`,
        link: '/dashboard/gigs',
      });
    }
  } catch {
    /* notification failure shouldn't block */
  }

  // Send email notification to client on status change
  try {
    if (status === 'confirmed') {
      // Generate deposit payment link and send confirmation with it
      if (crewRequest.deposit_amount && crewRequest.deposit_amount > 0) {
        try {
          const { payments } = await import('@/lib/payments');
          if (payments.isConfigured()) {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://thabangvision.com';
            const result = await payments.createCheckout({
              paymentId: id,
              amount: crewRequest.deposit_amount,
              itemName: `Deposit: ${crewRequest.project_type}`,
              itemDescription: '20% deposit for creator booking',
              email: crewRequest.client_email,
              returnUrl: `${baseUrl}/dashboard/creator-requests/${id}?payment=success`,
              cancelUrl: `${baseUrl}/dashboard/creator-requests/${id}?payment=cancelled`,
              metadata: {
                customStr1: 'crew_request_deposit',
                customStr2: crewRequest.creator_id,
              },
            });

            await emailProvider.sendEmail({
              to: crewRequest.client_email,
              subject: `Creator Request Confirmed — ${STUDIO.name}`,
              text: `Hi ${crewRequest.client_name},\n\nGreat news! Your ${crewRequest.project_type} request has been confirmed by the creator.\n\nEstimated Total: R${crewRequest.total_amount}\nDeposit Required: R${crewRequest.deposit_amount} (20%)\n\nPay your deposit here: ${result.paymentUrl}\n\nOnce your deposit is received, the creator will begin preparing for your project.\n\nThank you,\n${STUDIO.name}\n${STUDIO.meta.url}`,
            });
          }
        } catch (err) {
          console.error('[creator-requests] Deposit link generation failed:', err);
          // Fall back to basic confirmation email
          await emailProvider.sendEmail({
            to: crewRequest.client_email,
            subject: `Creator Request Confirmed — ${STUDIO.name}`,
            text: `Hi ${crewRequest.client_name},\n\nGreat news! Your ${crewRequest.project_type} request has been confirmed by the creator.\n\nPlease visit your dashboard to complete the deposit payment.\n\nThank you,\n${STUDIO.name}\n${STUDIO.meta.url}`,
          });
        }
      } else {
        // No deposit amount — send basic confirmation
        await emailProvider.sendEmail({
          to: crewRequest.client_email,
          subject: `Creator Request Confirmed — ${STUDIO.name}`,
          text: `Hi ${crewRequest.client_name},\n\nGreat news! Your ${crewRequest.project_type} request has been confirmed by the creator.\n\nWe'll be in touch shortly with next steps.\n\nThank you,\n${STUDIO.name}\n${STUDIO.meta.url}`,
        });
      }
    } else if (status === 'declined') {
      await emailProvider.sendEmail({
        to: crewRequest.client_email,
        subject: `Creator Request Update — ${STUDIO.name}`,
        text: `Hi ${crewRequest.client_name},\n\nUnfortunately, the creator is not available for your ${crewRequest.project_type} request at this time.\n\nWe'd love to help you find another match — visit ${STUDIO.meta.url}/studio or chat with Ubunye.\n\nThank you,\n${STUDIO.name}`,
      });
    } else if (status === 'completed') {
      await emailProvider.sendEmail({
        to: crewRequest.client_email,
        subject: `Project Completed — ${STUDIO.name}`,
        text: `Hi ${crewRequest.client_name},\n\nYour ${crewRequest.project_type} project has been marked as complete.\n\nWe hope you had a great experience! If you'd like to leave a review, visit your dashboard.\n\nThank you for choosing ${STUDIO.name}!\n${STUDIO.meta.url}`,
      });
    }
  } catch {
    // Email failure should not block the status update
  }

  // No automatic payout here. This route used to send a Paystack transfer from
  // ThabangVision's balance whenever a creator marked their own request
  // completed, with no check that the client had paid (and anyone can create
  // a crew request). Gig payouts are now made by an admin after checking the
  // payment; the admin is told a request was completed.
  if (status === 'completed' && isCreator) {
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `Crew request completed, payout to review: ${id}`,
        text: `A creator marked crew request ${id} (${crewRequest.project_type}) as completed.

Check that the client paid, then make the payout from the admin dashboard.`,
      });
    } catch { /* don't block */ }
  }

  return NextResponse.json({ success: true, status });
}
