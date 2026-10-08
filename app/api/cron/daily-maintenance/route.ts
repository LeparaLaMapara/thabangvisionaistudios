export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { triggerCreatorPayout } from '@/lib/payments/payout';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { autoPublishCreatorProductions } from '@/lib/supabase/queries/smartProductions';
import { effectiveHoldMinutes } from '@/lib/rental/availability-server';
import { notifyClient } from '@/lib/bookings/notify-client';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';
import { paymentReference } from '@/lib/payments/eft';
import { autoSendWelcomes, draftMissingWelcomes } from '@/lib/greetings/process';
import { runOverdueLadder } from '@/lib/rental/workers';
import { buildNotices } from '@/lib/core/rental/notifications';

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

  // ─── 0b. Release expired equipment checkout holds ────────────────────────
  // A hold is taken at CHECKOUT, before payment. Without an expiry an
  // abandoned payment page removed those dates from sale permanently -- five
  // ranges were stuck on production, the oldest for 161 days.
  //
  // Keyed on payment being absent, not on status alone: a PAID booking still
  // sitting in 'pending' because a webhook has not landed must never be
  // released, or the gear gets sold twice.
  try {
    // While online payment is off, EFT requests hold their dates for 48 hours
    // so the customer can pay; otherwise the usual short checkout hold. Cash
    // bookings are paid at collection and are handled below, not here.
    const holdCutoff = new Date(
      now.getTime() - effectiveHoldMinutes() * 60_000,
    ).toISOString();

    // Orders reserved through the Phase 1 pipeline (with a hold_expires_at)
    // are released by /api/cron/rental-pipeline, which first asks the provider
    // about missed payments and marks them 'hold_expired' so a late payment
    // can still be confirmed. This step only handles older rows.
    const release = (pipelineAware: boolean) => {
      let q = supabase
        .from('equipment_bookings')
        .update({
          status: 'cancelled',
          cancelled_at: now.toISOString(),
          updated_at: now.toISOString(),
          cancellation_refund_status: 'not_required',
        })
        .eq('status', 'pending')
        .is('payfast_payment_id', null)
        .or('payment_method.is.null,payment_method.neq.cash')
        .lt('created_at', holdCutoff);
      if (pipelineAware) q = q.is('hold_expires_at', null);
      return q.select('id, checkout_group_id, amount_due, payment_method');
    };
    let { data: released, error } = await release(true);
    if (error && /hold_expires_at/.test(error.message)) ({ data: released, error } = await release(false));

    if (error) throw new Error(error.message);
    results.expiredHoldsReleased = released?.length ?? 0;

    // Tell each customer whose EFT order was released (one message per order),
    // and give the owner the list.
    const releasedOrders = (released ?? []).filter((b) => b.payment_method === 'eft' && b.amount_due != null);
    for (const b of releasedOrders) {
      const orderId = b.checkout_group_id ?? b.id;
      await sendGearNotice('payment_released', await loadNoticeBookings([b.id]), { reference: paymentReference(orderId) });
    }
    if (releasedOrders.length > 0) {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Released] ${releasedOrders.length} unpaid EFT booking(s) — ${STUDIO.name}`,
        text: `These EFT bookings were not paid within ${STUDIO.bank.payWithinHours} hours and were released:\n\n${releasedOrders.map((b) => `${paymentReference(b.checkout_group_id ?? b.id)}: R${b.amount_due}`).join('\n')}\n\nThe customers were told. If one of them paid, mark it paid in admin and re-book the dates with them.`,
      });
    }
  } catch (err) {
    results.expiredHoldsError = String(err);
  }

  // ─── 0c. EFT reminder after 24 hours, once per order ────────────────────
  try {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: waiting } = await supabase
      .from('equipment_bookings')
      .select('id, checkout_group_id, amount_due')
      .eq('status', 'pending')
      .eq('payment_method', 'eft')
      .is('payfast_payment_id', null)
      .not('amount_due', 'is', null)
      .lt('created_at', dayAgo);
    let reminded = 0;
    for (const b of waiting ?? []) {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'gear_payment_reminder')
        .eq('link', `/dashboard/bookings/${b.id}`);
      if ((count ?? 0) > 0) continue;
      await sendGearNotice('payment_reminder', await loadNoticeBookings([b.id]), {
        amountDue: Number(b.amount_due),
        reference: paymentReference(b.checkout_group_id ?? b.id),
      });
      reminded++;
    }
    results.eftReminders = reminded;
  } catch (err) {
    results.eftRemindersError = String(err);
  }

  // ─── 0d. Cash bookings nobody collected: release the day after ──────────
  try {
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
    // Pipeline cash holds (hold_expires_at = end of the hire day) are released
    // by /api/cron/rental-pipeline as 'hold_expired'; this handles older rows.
    const releaseCash = (pipelineAware: boolean) => {
      let q = supabase
        .from('equipment_bookings')
        .update({
          status: 'cancelled',
          cancelled_at: now.toISOString(),
          updated_at: now.toISOString(),
          cancellation_refund_status: 'not_required',
        })
        .eq('status', 'pending')
        .eq('payment_method', 'cash')
        .lt('start_date', today);
      if (pipelineAware) q = q.is('hold_expires_at', null);
      return q.select('id, checkout_group_id, amount_due');
    };
    let { data: uncollected, error: cashErr } = await releaseCash(true);
    if (cashErr && /hold_expires_at/.test(cashErr.message)) ({ data: uncollected, error: cashErr } = await releaseCash(false));
    if (cashErr) throw new Error(cashErr.message);
    results.cashNotCollectedReleased = uncollected?.length ?? 0;
    const orders = (uncollected ?? []).filter((b) => b.amount_due != null);
    if (orders.length > 0) {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Released] ${orders.length} cash booking(s) not collected — ${STUDIO.name}`,
        text: `These cash-at-collection bookings passed their first hire day without being collected and were released:\n\n${orders.map((b) => paymentReference(b.checkout_group_id ?? b.id)).join('\n')}`,
      });
    }
  } catch (err) {
    results.cashReleaseError = String(err);
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
    // Nobody should find out by accident that their request is gone.
    for (const b of unpaid ?? []) {
      await notifyClient({
        bookingId: b.id,
        type: 'booking_expired',
        title: 'Your booking request has expired',
        body: `Your request ${b.reference} was not paid within 72 hours, so it has been closed and nothing was charged. If you still need this, book again or reply to this email and we will help.`,
      });
    }
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

  // ─── 4. Flag stale accepted bookings (30+ days) for a person ──────────────
  // These used to be marked 'completed' automatically, which made them
  // eligible for a creator payout although nothing was ever delivered. Now
  // they are left as they are and the team is asked to contact both sides.
  try {
    const staleCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await supabase
      .from('bookings')
      .select('id, reference, accepted_at')
      .eq('status', 'accepted')
      .lt('accepted_at', staleCutoff);

    results.staleAcceptedForReview = stale?.length ?? 0;

    if (stale && stale.length > 0) {
      const list = stale.map((s) => `${s.reference} (accepted ${String(s.accepted_at).slice(0, 10)})`).join('\n');
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Review] ${stale.length} booking(s) accepted 30+ days ago, not delivered — ${STUDIO.name}`,
        text: `These service bookings were accepted more than 30 days ago and nothing has been delivered:

${list}

Please contact the client and the creator. They are not paid out or refunded automatically.`,
      });
    }
  } catch (err) {
    results.staleAcceptedError = String(err);
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

  // ─── 8–9. Overdue rentals: the escalation ladder ─────────────────────────
  // Marks hires past their return time (end of the end date, SAST) overdue and
  // records the +2h/+24h/+48h/+96h escalation stages for staff, with reminders
  // to the renter (lib/rental/workers.ts, spec §7.13). This replaced a step
  // that opened a "not returned" dispute after 14 days with the RENTER as the
  // person filing it, and set the booking to disputed automatically. Treating a
  // late return as a dispute or theft is a person's decision, not a job's.
  try {
    results.overdueRentals = await runOverdueLadder(supabase);
  } catch (err) {
    console.error('[daily-maintenance] overdue ladder failed:', err);
    results.overdueRentals = { error: String(err) };
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

        // Flag for a person to review; never suspend automatically (spec
        // §7.13: human decisions, records and appeals). The renter's open
        // disputes already route new gear bookings to manual approval
        // (lib/core/rental/trust.ts).
        // One alert per user per week (dedupe key), delivered to admins by the outbox.
        const week = Math.floor(Date.now() / (7 * 86_400_000));
        await supabase.rpc('outbox_enqueue', {
          p_notices: buildNotices({
            kind: 'staff_alert',
            userId: 'staff',
            bookingIds: [],
            discriminator: `dispute-review:${profile.id}:${week}`,
            data: { what: `${count}_open_disputes_review_user`, reference: profile.id },
          }),
        });
        autoSuspended++;
      }
    }
    results.disputeReview = { usersWithDisputes: userDisputeCounts.size, flaggedForReview: autoSuspended };
  } catch (err) {
    console.error('[daily-maintenance] auto-suspension failed:', err);
    results.autoSuspension = { error: String(err) };
  }

  // ─── 11. (removed) Automatic suspension after 30 days overdue ─────────────
  // Replaced by the escalation ladder's senior-review stage (+96h), where a
  // person decides on recovery steps. Gear overdue past formal escalation
  // already pauses that renter's new bookings (lib/core/rental/trust.ts).

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

  // ─── 13b. Day-before reminders: collect tomorrow, return tomorrow ─────────
  // One message per order (a cart order is several lines), never twice.
  try {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
    const sent: Record<string, number> = { collect: 0, return: 0 };
    for (const [kind, status, column] of [
      ['collect_tomorrow', ['confirmed'], 'start_date'],
      ['return_tomorrow', ['active'], 'end_date'],
    ] as const) {
      const { data: due } = await supabase
        .from('equipment_bookings')
        .select('id, checkout_group_id')
        .in('status', status as unknown as string[])
        .eq(column, tomorrow);
      const orders = new Map<string, string[]>();
      for (const b of due ?? []) {
        const key = b.checkout_group_id ?? b.id;
        orders.set(key, [...(orders.get(key) ?? []), b.id]);
      }
      for (const ids of orders.values()) {
        const { count } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('type', `gear_${kind}`)
          .eq('link', `/dashboard/bookings/${ids[0]}`);
        if ((count ?? 0) > 0) continue;
        await sendGearNotice(kind, await loadNoticeBookings(ids));
        sent[kind === 'collect_tomorrow' ? 'collect' : 'return']++;
      }
    }
    results.gearReminders = sent;
  } catch (err) {
    results.gearRemindersError = String(err);
  }

  // ─── 14. Welcome anyone the signup trigger missed (last 3 days) ──────────
  try {
    results.welcomes = await draftMissingWelcomes({ sinceDays: 3, notifyOwner: true });
    results.welcomesAutoSent = await autoSendWelcomes(STUDIO.welcomes.autoSendAfterHours);
  } catch (err) {
    console.error('[daily-maintenance] welcome sweep failed:', err);
    results.welcomes = { error: String(err) };
  }

  console.log('[daily-maintenance] Results:', JSON.stringify(results));

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    results,
  });
}
