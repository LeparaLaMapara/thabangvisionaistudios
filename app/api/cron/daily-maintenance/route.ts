export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { triggerCreatorPayout } from '@/lib/payments/payout';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

/**
 * Daily Maintenance — runs at 2am SAST (00:00 UTC)
 *
 * 1. Cancel unpaid bookings older than 72 hours
 * 2. Auto-approve delivered bookings past 7-day window
 * 3. Trigger payouts for newly completed bookings
 * 4. Check for stuck payouts (processing > 24 hours)
 * 5. Auto-complete stale accepted bookings (30+ days)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createAdminClient();
  const results: Record<string, unknown> = {};
  const now = new Date();

  // ─── 1. Cancel unpaid bookings > 72 hours ─────────────────────────────────
  try {
    const cutoff = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
    const { data: unpaid } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancellation_reason: 'Auto-cancelled: unpaid after 72 hours',
        updated_at: now.toISOString(),
      })
      .eq('status', 'pending')
      .eq('payment_status', 'unpaid')
      .lt('created_at', cutoff)
      .select('id, reference');

    results.cancelledUnpaid = unpaid?.length ?? 0;
  } catch (err) {
    results.cancelledUnpaidError = String(err);
  }

  // ─── 2. Auto-approve delivered bookings > 7 days ──────────────────────────
  try {
    const approvalCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: autoApproved } = await supabase
      .from('bookings')
      .update({
        status: 'completed',
        completed_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('status', 'delivered')
      .lt('delivered_at', approvalCutoff)
      .select('id, reference, creator_id, creator_amount, project_category, payment_status');

    results.autoApproved = autoApproved?.length ?? 0;

    // Trigger payouts for auto-approved bookings
    if (autoApproved && autoApproved.length > 0) {
      let payoutSuccesses = 0;
      let payoutFailures = 0;

      for (const booking of autoApproved) {
        if (booking.creator_id && booking.payment_status === 'paid') {
          const payoutResult = await triggerCreatorPayout({
            bookingId: booking.id,
            reference: booking.reference,
            creatorId: booking.creator_id,
            creatorAmount: booking.creator_amount,
            projectCategory: booking.project_category,
          });
          if (payoutResult.success) payoutSuccesses++;
          else payoutFailures++;
        }
      }

      results.autoPayouts = { success: payoutSuccesses, failed: payoutFailures };
    }
  } catch (err) {
    results.autoApprovedError = String(err);
  }

  // ─── 3. Check for stuck payouts (processing > 24 hours) ──────────────────
  try {
    const stuckCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: stuck } = await supabase
      .from('bookings')
      .select('id, reference, creator_amount, payout_reference')
      .eq('payout_status', 'processing')
      .lt('updated_at', stuckCutoff);

    results.stuckPayouts = stuck?.length ?? 0;

    if (stuck && stuck.length > 0) {
      const stuckList = stuck.map(s => `${s.reference}: R${s.creator_amount}`).join('\n');
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Alert] ${stuck.length} stuck payout(s) — ${STUDIO.name}`,
        text: `The following payouts have been in "processing" status for over 24 hours:\n\n${stuckList}\n\nPlease check Paystack dashboard and resolve manually.`,
      });
    }
  } catch (err) {
    results.stuckPayoutsError = String(err);
  }

  // ─── 4. Auto-complete stale accepted bookings (30+ days) ──────────────────
  try {
    const staleCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await supabase
      .from('bookings')
      .update({
        status: 'completed',
        completed_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('status', 'accepted')
      .lt('accepted_at', staleCutoff)
      .select('id, reference');

    results.autoCompletedStale = stale?.length ?? 0;
  } catch (err) {
    results.autoCompletedStaleError = String(err);
  }

  // ─── 5. Expire stale crew requests ────────────────────────────────────────
  try {
    const expiryCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: expired } = await supabase
      .from('creator_requests')
      .update({
        status: 'expired',
        updated_at: now.toISOString(),
      })
      .eq('status', 'pending')
      .lt('created_at', expiryCutoff)
      .select('id');

    results.expiredCrewRequests = expired?.length ?? 0;
  } catch (err) {
    results.expiredCrewRequestsError = String(err);
  }

  console.log('[daily-maintenance] Results:', JSON.stringify(results));

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    results,
  });
}
