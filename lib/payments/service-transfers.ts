import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { recordServiceBookingEvent, updateServiceBooking } from '@/lib/supabase/queries/service-bookings';

/**
 * Transfer events for creator payouts on SERVICE bookings (the `bookings`
 * table), called from the payment inbox. Gear owner payouts use
 * owner_payouts instead (lib/core/rental/payouts.ts).
 *
 * Matched on bookings.payout_reference, which holds either the stable
 * reference (`tvsp_<booking id>`, lib/core/services/payouts.ts) or, for
 * transfers sent before it existed, an older `payout-<ref>-<time>` one. Both
 * resolve the same way, so transfers still in flight under an old reference
 * finish normally.
 *
 * - success: paid (and the booking paid_out, if it was completed). Repeats are no-ops.
 * - failed: marked failed, never re-sent here; the daily run looks the
 *   reference up before anything is sent again, and a person is told.
 * - reversed: money came back. If we had recorded it paid, the booking goes
 *   back to completed with the payout failed, and a person is told.
 */

export async function handleServiceTransferEvent(event: string, reference: string): Promise<void> {
  if (!reference) return;
  if (event === 'transfer.success') await handleTransferSuccess(reference);
  else if (event === 'transfer.failed' || event === 'transfer.reversed') await handleTransferProblem(reference, event === 'transfer.reversed' ? 'reversed' : 'failed');
}

interface PayoutRow {
  id: string;
  reference: string;
  status: string | null;
  payout_status: string | null;
  creator_id: string | null;
  creator_amount: number | null;
  project_category: string | null;
}

async function findByReference(reference: string): Promise<PayoutRow | null> {
  const { data, error } = await createAdminClient()
    .from('bookings')
    .select('id, reference, status, payout_status, creator_id, creator_amount, project_category')
    .eq('payout_reference', reference)
    .maybeSingle();
  if (error) {
    // Thrown so the inbox keeps the event and processes it again later.
    throw new Error(`service transfer lookup failed: ${error.message}`);
  }
  return (data as PayoutRow | null) ?? null;
}

async function handleTransferSuccess(reference: string): Promise<void> {
  console.log(`[paystack-webhook] TRANSFER SUCCESS: ref=${reference}`);
  const booking = await findByReference(reference);
  if (!booking) return;
  if (booking.payout_status === 'paid') {
    console.log(`[paystack-webhook] Transfer already processed: ref=${reference}`);
    return;
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { payout_status: 'paid', paid_out_at: now, payout_last_error: null, updated_at: now };
  if (booking.status === 'completed') patch.status = 'paid_out';
  const r = await updateServiceBooking(supabase, booking.id, null, patch);
  if (!r.ok) {
    throw new Error(`transfer success update failed: ${r.error}`);
  }
  await recordServiceBookingEvent(supabase, {
    bookingId: booking.id, event: 'payout_confirmed', from: booking.status, to: (patch.status as string | undefined) ?? booking.status, actor: 'system', actorId: null, reason: reference,
  });

  if (booking.creator_id) {
    try {
      await supabase.from('notifications').insert({
        user_id: booking.creator_id,
        type: 'payout_complete',
        title: 'Payout Complete',
        body: `The provider confirms your payout of R${booking.creator_amount} for ${booking.project_category} (${booking.reference}) was sent. When it shows in your account depends on your bank.`,
        link: '/dashboard/gigs',
      });
    } catch { /* don't block */ }
  }
}

async function handleTransferProblem(reference: string, what: 'failed' | 'reversed'): Promise<void> {
  console.error(`[paystack-webhook] TRANSFER ${what.toUpperCase()}: ref=${reference}`);
  const booking = await findByReference(reference);
  if (!booking) return;

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  if (booking.payout_status === 'paid' && what === 'failed') {
    // A late failure after success is ignored: success is final unless reversed.
    console.log(`[paystack-webhook] Ignoring failure after success: ref=${reference}`);
    return;
  }
  if (booking.payout_status === 'failed') {
    console.log(`[paystack-webhook] Transfer already marked failed: ref=${reference}`);
    return;
  }

  const patch: Record<string, unknown> = { payout_status: 'failed', payout_last_error: `provider reported the transfer ${what}`, updated_at: now };
  if (booking.status === 'paid_out') patch.status = 'completed';
  const r = await updateServiceBooking(supabase, booking.id, null, patch);
  if (!r.ok) throw new Error(`transfer ${what} update failed: ${r.error}`);
  await recordServiceBookingEvent(supabase, {
    bookingId: booking.id, event: `payout_${what}`, from: booking.status, to: (patch.status as string | undefined) ?? booking.status, actor: 'system', actorId: null, reason: reference,
  });

  try {
    await emailProvider.sendEmail({
      to: STUDIO.billingEmail,
      subject: `[Action] Creator payout ${what} — ${booking.reference}`,
      text: `The payment provider reports the creator payout for ${booking.reference} (R${booking.creator_amount}) as ${what}.\n\nTransfer reference: ${reference}\n\nIt will NOT be re-sent automatically under a new reference. Check the transfer in the provider dashboard (for example, a wrong or closed bank account), then pay the creator by hand and record it in admin.`,
    });
  } catch { /* don't block */ }
}
