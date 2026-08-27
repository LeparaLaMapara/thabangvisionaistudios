export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { triggerCreatorPayout } from '@/lib/payments/payout';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { autoPublishCreatorProductions } from '@/lib/supabase/queries/smartProductions';

/**
 * Daily Maintenance — runs at 2am SAST (00:00 UTC)
 *
 * 1. Cancel unpaid bookings older than 72 hours
 * 2. Auto-approve delivered bookings past 7-day window + trigger payouts
 * 3. Retry failed payouts (max 3 attempts, 6h+ apart)
 * 4. Check for stuck payouts (processing > 24 hours)
 * 5. Auto-complete stale accepted bookings (30+ days)
 * 6. Expire stale crew requests
 * 7. Auto-reassign unresponsive creators (48h with no acknowledgement)
 * 8. Auto-detect overdue rentals
 * 9. Auto-escalate unreturned gear to disputes (14+ days overdue)
 * 10. Auto-flag/suspend users with 3+ active disputes
 * 11. Auto-suspend users with gear overdue 30+ days
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createAdminClient();
  const results: Record<string, unknown> = {};
  const now = new Date();

  // ─── 0. Prune expired rate-limit windows ─────────────────────────────────
  // rate_limits gains a row per (key, window). Old windows are dead weight.
  try {
    const { data: pruned, error } = await supabase.rpc('rate_limits_prune', { p_older_than_hours: 24 });
    if (error) throw new Error(error.message);
    results.rateLimitRowsPruned = pruned ?? 0;
  } catch (err) {
    results.rateLimitPruneError = String(err);
  }

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

  // ─── 3. Retry failed payouts (max 3 attempts, 6h+ apart) ─────────────────
  try {
    const retryCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const { data: failedPayouts } = await supabase
      .from('bookings')
      .select('id, reference, creator_id, creator_amount, project_category, payout_retry_count')
      .eq('payout_status', 'failed')
      .eq('payment_status', 'paid')
      .lt('updated_at', retryCutoff);

    let retrySuccesses = 0;
    let retryFailures = 0;
    let retryExhausted = 0;

    if (failedPayouts && failedPayouts.length > 0) {
      for (const booking of failedPayouts) {
        const retryCount = booking.payout_retry_count ?? 0;

        if (retryCount >= 3) {
          retryExhausted++;
          continue;
        }

        // Increment retry count before attempting
        await supabase
          .from('bookings')
          .update({ payout_retry_count: retryCount + 1, updated_at: now.toISOString() })
          .eq('id', booking.id);

        const payoutResult = await triggerCreatorPayout({
          bookingId: booking.id,
          reference: booking.reference,
          creatorId: booking.creator_id,
          creatorAmount: booking.creator_amount,
          projectCategory: booking.project_category,
        });

        if (payoutResult.success) {
          retrySuccesses++;
        } else {
          retryFailures++;

          // Final attempt failed — alert admin
          if (retryCount + 1 >= 3) {
            await emailProvider.sendEmail({
              to: STUDIO.bookingEmail,
              subject: `[Critical] Payout permanently failed — ${booking.reference}`,
              text: `Payout for booking ${booking.reference} (R${booking.creator_amount}) has failed after 3 attempts.\n\nPlease process this payout manually via the Paystack dashboard.\n\nBooking ID: ${booking.id}`,
            });
          }
        }
      }
    }

    results.payoutRetries = { success: retrySuccesses, failed: retryFailures, exhausted: retryExhausted };
  } catch (err) {
    results.payoutRetriesError = String(err);
  }

  // ─── 4. Check for stuck payouts (processing > 24 hours) ──────────────────
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
      .from('crew_requests')
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

  // ─── 7. Auto-reassign unresponsive creators (48h with no acknowledgement) ─
  try {
    const responseCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const { data: unresponsive } = await supabase
      .from('bookings')
      .select('id, reference, creator_id, project_category, client_email')
      .eq('status', 'paid')
      .is('accepted_at', null)
      .lt('created_at', responseCutoff);

    let reassigned = 0;

    if (unresponsive && unresponsive.length > 0) {
      for (const booking of unresponsive) {
        // Unassign creator from booking
        await supabase
          .from('bookings')
          .update({
            creator_id: null,
            status: 'pending_reassignment',
            updated_at: now.toISOString(),
          })
          .eq('id', booking.id);

        // Notify admin for manual reassignment
        await emailProvider.sendEmail({
          to: STUDIO.bookingEmail,
          subject: `[Action Required] Creator unresponsive — ${booking.reference}`,
          text: `Creator did not acknowledge booking ${booking.reference} (${booking.project_category}) within 48 hours.\n\nThe booking has been unassigned and needs manual reassignment.\n\nClient email: ${booking.client_email}\nBooking ID: ${booking.id}\n\nPlease reassign to another creator in the admin panel.`,
        });

        // Notify creator they lost the gig
        if (booking.creator_id) {
          try {
            await supabase.from('notifications').insert({
              user_id: booking.creator_id,
              type: 'gig_unassigned',
              title: 'Gig Unassigned',
              body: `Booking ${booking.reference} was unassigned because you did not respond within 48 hours.`,
              link: '/dashboard/gigs',
            });
          } catch { /* don't block */ }
        }

        reassigned++;
      }
    }

    results.autoReassigned = reassigned;
  } catch (err) {
    results.autoReassignedError = String(err);
  }

  // ─── 8. Auto-detect overdue rentals ──────────────────────────────────────────
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: overdueRentals, error: overdueError } = await supabase
      .from('equipment_bookings')
      .update({ status: 'overdue', updated_at: new Date().toISOString() })
      .eq('status', 'active')
      .lt('end_date', today)
      .select('id, user_id');

    if (overdueError) throw overdueError;

    // Notify renters
    for (const booking of overdueRentals ?? []) {
      await supabase.from('notifications').insert({
        user_id: booking.user_id,
        type: 'rental_overdue',
        title: 'Your rental is overdue',
        body: 'Please return your gear. Late fees may apply.',
        link: `/dashboard/bookings/${booking.id}`,
      });
    }

    results.overdueRentals = { marked: overdueRentals?.length ?? 0 };
  } catch (err) {
    console.error('[daily-maintenance] overdue rental detection failed:', err);
    results.overdueRentals = { error: String(err) };
  }

  // ─── 9. Auto-escalate unreturned gear to disputes (14+ days overdue) ──────
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const cutoff = fourteenDaysAgo.toISOString().split('T')[0];

    const { data: unreturned } = await supabase
      .from('equipment_bookings')
      .select('id, user_id, rental_id')
      .eq('status', 'overdue')
      .lt('end_date', cutoff);

    let escalated = 0;
    if (unreturned && unreturned.length > 0) {
      const unreturnedIds = unreturned.map((b) => b.id);
      const { data: existingDisputes } = await supabase
        .from('disputes')
        .select('equipment_booking_id')
        .eq('dispute_type', 'gear_not_returned')
        .in('equipment_booking_id', unreturnedIds);

      const disputedBookingIds = new Set((existingDisputes ?? []).map((d) => d.equipment_booking_id));

      for (const booking of unreturned) {
        if (disputedBookingIds.has(booking.id)) continue;

        await supabase.from('disputes').insert({
          dispute_type: 'gear_not_returned',
          equipment_booking_id: booking.id,
          filed_by: booking.user_id,
          reason: 'Gear not returned after 14+ days overdue. Auto-escalated.',
          status: 'open',
        });
        await supabase
          .from('equipment_bookings')
          .update({ status: 'disputed', disputed_at: new Date().toISOString() })
          .eq('id', booking.id);
        escalated++;
      }
    }
    results.disputeEscalation = { escalated };
  } catch (err) {
    console.error('[daily-maintenance] dispute escalation failed:', err);
    results.disputeEscalation = { error: String(err) };
  }

  // ─── 10. Auto-flag users with 3+ disputes for review ─────────────────────
  try {
    // filed_by matters: a dispute counts against the OTHER party, never against
    // the person who raised it. Without it this loop counted
    // equipment_bookings.user_id -- the renter -- so a customer who reported
    // broken gear three times was auto-suspended, delisted, and recorded in
    // moderation_log as their own suspending admin.
    const { data: allDisputes } = await supabase
      .from('disputes')
      .select('booking_id, equipment_booking_id, filed_by')
      .in('status', ['open', 'investigating']);

    const userDisputeCounts = new Map<string, number>();

    if (allDisputes && allDisputes.length > 0) {
      // Batch-fetch equipment booking user IDs
      const ebIds = allDisputes.map((d) => d.equipment_booking_id).filter(Boolean) as string[];
      if (ebIds.length > 0) {
        const { data: ebs } = await supabase
          .from('equipment_bookings')
          .select('id, user_id')
          .in('id', ebIds);
        const ebUserMap = new Map((ebs ?? []).map((eb) => [eb.id, eb.user_id]));
        for (const dispute of allDisputes) {
          if (dispute.equipment_booking_id) {
            const uid = ebUserMap.get(dispute.equipment_booking_id);
            // Skip when the renter is the complainant.
            if (uid && uid !== dispute.filed_by) {
              userDisputeCounts.set(uid, (userDisputeCounts.get(uid) ?? 0) + 1);
            }
          }
        }
      }

      // Batch-fetch service booking creator IDs
      const bkIds = allDisputes.map((d) => d.booking_id).filter(Boolean) as string[];
      if (bkIds.length > 0) {
        const { data: bks } = await supabase
          .from('bookings')
          .select('id, creator_id')
          .in('id', bkIds);
        const bkCreatorMap = new Map((bks ?? []).map((bk) => [bk.id, bk.creator_id]));
        for (const dispute of allDisputes) {
          if (dispute.booking_id) {
            const cid = bkCreatorMap.get(dispute.booking_id);
            // Skip when the creator is the complainant.
            if (cid && cid !== dispute.filed_by) {
              userDisputeCounts.set(cid, (userDisputeCounts.get(cid) ?? 0) + 1);
            }
          }
        }
      }
    }

    // Batch-fetch profiles for users with 3+ disputes
    const flaggedUserIds = [...userDisputeCounts.entries()]
      .filter(([, count]) => count >= 3)
      .map(([uid]) => uid);

    let autoSuspended = 0;
    if (flaggedUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, is_suspended')
        .in('id', flaggedUserIds);

      for (const profile of profiles ?? []) {
        if (profile.is_suspended) continue;
        const count = userDisputeCounts.get(profile.id) ?? 0;

        await supabase.from('profiles').update({
          is_suspended: true,
          suspended_at: new Date().toISOString(),
          suspension_reason: `Auto-suspended: ${count} active disputes filed against this user.`,
        }).eq('id', profile.id);

        await supabase.from('moderation_log').insert({
          user_id: profile.id,
          action: 'suspended',
          reason: `Auto-suspended: ${count} active disputes.`,
          admin_id: null,
          metadata: { trigger: 'auto_dispute_count', dispute_count: count, actor: 'system:daily-maintenance' },
        });

        await supabase.from('smart_rentals').update({ is_available: false }).eq('owner_id', profile.id);
        autoSuspended++;
      }
    }
    results.autoSuspension = { flaggedUsers: userDisputeCounts.size, autoSuspended };
  } catch (err) {
    console.error('[daily-maintenance] auto-suspension failed:', err);
    results.autoSuspension = { error: String(err) };
  }

  // ─── 11. Auto-suspend users with gear overdue 30+ days ────────────────────
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff30 = thirtyDaysAgo.toISOString().split('T')[0];

    const { data: severeOverdue } = await supabase
      .from('equipment_bookings')
      .select('user_id')
      .in('status', ['overdue', 'disputed'])
      .lt('end_date', cutoff30);

    const uniqueUserIds = [...new Set((severeOverdue ?? []).map((b) => b.user_id))];
    let suspended30 = 0;

    if (uniqueUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, is_suspended')
        .in('id', uniqueUserIds)
        .eq('is_suspended', false);

      for (const profile of profiles ?? []) {
        await supabase.from('profiles').update({
          is_suspended: true,
          suspended_at: new Date().toISOString(),
          suspension_reason: 'Auto-suspended: gear overdue for 30+ days.',
        }).eq('id', profile.id);

        await supabase.from('moderation_log').insert({
          user_id: profile.id,
          action: 'suspended',
          reason: 'Auto-suspended: gear overdue 30+ days.',
          admin_id: profile.id,
          metadata: { trigger: 'auto_overdue_30_days' },
        });

        await supabase.from('smart_rentals').update({ is_available: false }).eq('owner_id', profile.id);
        suspended30++;
      }
    }
    results.overdueAutoSuspension = { checked: severeOverdue?.length ?? 0, suspended: suspended30 };
  } catch (err) {
    console.error('[daily-maintenance] 30-day overdue suspension failed:', err);
    results.overdueAutoSuspension = { error: String(err) };
  }

  // ─── 12. Abandoned cart recovery notifications ────────────────────────────
  try {
    const cartCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const recentCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleCarts } = await supabase
      .from('cart_items')
      .select('user_id, created_at')
      .lt('created_at', cartCutoff)
      .gt('created_at', recentCutoff);

    const uniqueUsers = [...new Set((staleCarts ?? []).map((c) => c.user_id))];
    let nudged = 0;

    if (uniqueUsers.length > 0) {
      const { data: recentReminders } = await supabase
        .from('notifications')
        .select('user_id')
        .eq('type', 'cart_reminder')
        .gt('created_at', cartCutoff)
        .in('user_id', uniqueUsers);

      const alreadyNudged = new Set((recentReminders ?? []).map((n) => n.user_id));

      for (const userId of uniqueUsers) {
        if (alreadyNudged.has(userId)) continue;

        await supabase.from('notifications').insert({
          user_id: userId,
          type: 'cart_reminder',
          title: 'You left items in your cart',
          body: 'Your gear selections are still waiting. Complete your booking before availability changes.',
          link: '/rentals',
        });
        nudged++;
      }
    }

    results.cartRecovery = { staleCarts: uniqueUsers.length, nudged };
  } catch (err) {
    console.error('[daily-maintenance] cart recovery failed:', err);
    results.cartRecovery = { error: String(err) };
  }

  // ─── 13. Auto-publish creator productions pending 7+ days ─────────────────
  try {
    const published = await autoPublishCreatorProductions();
    results.autoPublishedCreators = published;
  } catch (err) {
    console.error('[daily-maintenance] auto-publish creators failed:', err);
    results.autoPublishedCreatorsError = String(err);
  }

  // ─── 13. POPIA: delete verification storage objects past retention ────────
  try {
    const retentionMs = STUDIO.legal.popia.retentionDays * 24 * 60 * 60 * 1000;
    const retentionCutoff = new Date(now.getTime() - retentionMs).toISOString();

    const { data: expired } = await supabase
      .from('profiles')
      .select('id, id_front_path, id_back_path, selfie_with_id_path, verification_reviewed_at')
      .in('verification_status', ['verified', 'rejected'])
      .lt('verification_reviewed_at', retentionCutoff)
      .not('id_front_path', 'is', null);

    let filesDeleted = 0;
    let profilesCleaned = 0;

    for (const profile of expired ?? []) {
      const paths = [
        profile.id_front_path,
        profile.id_back_path,
        profile.selfie_with_id_path,
      ].filter(Boolean) as string[];

      if (paths.length > 0) {
        const { error: removeErr } = await supabase.storage.from('verifications').remove(paths);
        if (!removeErr) {
          filesDeleted += paths.length;
          // Null out the path columns so we don't try again
          await supabase
            .from('profiles')
            .update({
              id_front_path: null,
              id_back_path: null,
              selfie_with_id_path: null,
            })
            .eq('id', profile.id);
          profilesCleaned++;
        }
      }
    }

    results.popiaRetention = {
      profilesCleaned,
      filesDeleted,
      retentionDays: STUDIO.legal.popia.retentionDays,
    };
  } catch (err) {
    console.error('[daily-maintenance] POPIA retention failed:', err);
    results.popiaRetention = { error: String(err) };
  }

  console.log('[daily-maintenance] Results:', JSON.stringify(results));

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    results,
  });
}
