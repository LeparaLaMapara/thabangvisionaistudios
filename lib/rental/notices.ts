import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { bankDetailsText, BANK_DETAILS_NEVER_CHANGE } from '@/lib/payments/eft';

/**
 * The messages a renter gets along the gear journey (the Apple pickup model:
 * you always know what happens next). One place, so the wording matches the
 * Terms and the dashboard. Each is an email plus a dashboard notification.
 */

export type GearNotice =
  | 'awaiting_payment'
  | 'payment_reminder'
  | 'payment_released'
  | 'confirmed'
  | 'collect_tomorrow'
  | 'return_tomorrow'
  | 'settled';

const where = (): string => {
  const f = STUDIO.fulfilment.dispatchFrom;
  return f.meetingPoint
    ? `${f.meetingPoint}, ${f.name}`
    : `${f.name}. We send you the exact spot the day before`;
};

export interface NoticeBooking {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  fulfilment_method?: string | null;
  title: string;
}

/** Subject and body for a notice. Pure, so the wording is tested. */
export function gearNoticeText(
  kind: GearNotice,
  items: NoticeBooking[],
  extra: { depositBack?: number; refundMethod?: string | null; kept?: number; amountDue?: number; reference?: string; method?: string } = {},
): { title: string; body: string } {
  const list = items.map((i) => i.title).join(', ');
  const first = items[0];
  const delivery = first?.fulfilment_method === 'delivery';
  const amount = `R${(extra.amountDue ?? 0).toLocaleString(STUDIO.currency.locale)}`;
  const ref = extra.reference ?? '';
  const payBy = STUDIO.bank.payWithinHours;
  switch (kind) {
    case 'awaiting_payment':
      return extra.method === 'cash'
        ? {
            title: 'Your gear is reserved',
            body: `Reserved: ${list}, ${first.start_date} to ${first.end_date}. Pay ${amount} in cash when you collect at ${where()} on ${first.start_date}. Bring your ID card. Your reference is ${ref}.`,
          }
        : {
            title: `Pay ${amount} by EFT to confirm your booking`,
            body: [
              `Reserved: ${list}, ${first.start_date} to ${first.end_date}.`,
              `To confirm, pay ${amount} by EFT within ${payBy} hours, using ${ref} as the reference:`,
              '',
              bankDetailsText(ref),
              '',
              `Then send your proof of payment on WhatsApp (${STUDIO.whatsapp.display}) or to ${STUDIO.bookingEmail}. We confirm as soon as it arrives.`,
              BANK_DETAILS_NEVER_CHANGE,
            ].join('\n'),
          };
    case 'payment_reminder':
      return {
        title: `Reminder: pay ${amount} to keep your booking`,
        body: [
          `Your ${list} for ${first.start_date} is still waiting for payment. Pay ${amount} by EFT with the reference ${ref} to keep your dates:`,
          '',
          bankDetailsText(ref),
          '',
          `Already paid? Send your proof on WhatsApp (${STUDIO.whatsapp.display}) or to ${STUDIO.bookingEmail}.`,
        ].join('\n'),
      };
    case 'payment_released':
      return {
        title: 'Your reserved gear has been released',
        body: `We did not receive payment for ${list} (${first.start_date} to ${first.end_date}, reference ${ref}), so the dates are open again and nothing was charged. If you paid, send your proof on WhatsApp (${STUDIO.whatsapp.display}) and we will sort it out straight away.`,
      };
    case 'confirmed':
      return {
        title: 'Your gear is booked',
        body: [
          `Booked: ${list}, ${first.start_date} to ${first.end_date}.`,
          delivery
            ? 'We deliver on your first hire day; we will confirm the time with you.'
            : `Collect from ${where()}. Hours: ${STUDIO.hours.weekday}, ${STUDIO.hours.weekend}.`,
          delivery ? 'Please have your ID card with you when we hand it over.' : 'Bring your ID card; we check it and hand the gear over with you.',
          `Return it by the end of ${first.end_date}.`,
        ].join(' '),
      };
    case 'collect_tomorrow':
      return {
        title: delivery ? 'Your gear arrives tomorrow' : 'Collect your gear tomorrow',
        body: delivery
          ? `${list} is delivered tomorrow (${first.start_date}). Have your ID card ready.`
          : `${list} is ready for you tomorrow (${first.start_date}) at ${where()}. Bring your ID card. Hours: ${STUDIO.hours.weekday}, ${STUDIO.hours.weekend}.`,
      };
    case 'return_tomorrow':
      return {
        title: 'Your gear is due back tomorrow',
        body: `Please return ${list} by the end of tomorrow (${first.end_date}) at ${where()}. Late returns cost R150 per item per day, taken from the deposit.`,
      };
    case 'settled': {
      const back = extra.depositBack ?? 0;
      const how = extra.refundMethod === 'card' ? 'to the card you paid with' : extra.refundMethod === 'eft' ? 'by EFT' : extra.refundMethod === 'cash' ? 'in cash' : '';
      return {
        title: 'Thanks, your return is done',
        body: back > 0
          ? `We have checked ${list}. Your deposit of R${back.toLocaleString(STUDIO.currency.locale)} is on its way back ${how}.${extra.kept ? ` R${extra.kept.toLocaleString(STUDIO.currency.locale)} was kept for late return or damage, as explained in your booking.` : ''} Thank you for looking after it.`
          : `We have checked ${list}.${extra.kept ? ` The deposit was kept for late return or damage, as explained in your booking.` : ''} Thank you.`,
      };
    }
  }
}

/** Sends a notice to the renter by email and in the dashboard. Never throws. */
export async function sendGearNotice(kind: GearNotice, items: NoticeBooking[], extra: Parameters<typeof gearNoticeText>[2] = {}): Promise<void> {
  if (items.length === 0) return;
  try {
    const admin = createAdminClient();
    const { title, body } = gearNoticeText(kind, items, extra);
    const link = `/dashboard/bookings/${items[0].id}`;
    await admin.from('notifications').insert({ user_id: items[0].user_id, type: `gear_${kind}`, title, body, link });
    const { data } = await admin.auth.admin.getUserById(items[0].user_id);
    if (data?.user?.email) {
      await emailProvider.sendEmail({
        to: data.user.email,
        subject: `${title} — ${STUDIO.name}`,
        text: `${body}\n\nYour booking: ${STUDIO.meta.url}${link}\nQuestions? Reply to this email or call ${STUDIO.phone}.\n\n${STUDIO.name}`,
      });
    }
  } catch (err) {
    console.error('[gear-notice]', kind, err);
  }
}

/** Loads bookings with their item title, ready for a notice. */
export async function loadNoticeBookings(ids: string[]): Promise<NoticeBooking[]> {
  if (ids.length === 0) return [];
  const { data } = await createAdminClient()
    .from('equipment_bookings')
    .select('id, user_id, start_date, end_date, fulfilment_method, smart_rentals(title)')
    .in('id', ids);
  const rows = (data ?? []).map((b) => {
    const r = Array.isArray(b.smart_rentals) ? b.smart_rentals[0] : b.smart_rentals;
    return { ...b, title: (r as { title?: string } | null)?.title ?? 'Equipment' } as NoticeBooking;
  });
  // Same order as asked for: the first id is the order's link and reminder key.
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}
