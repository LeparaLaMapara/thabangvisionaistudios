import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { sms } from '@/lib/sms';
import { STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { collectionPointWithCity } from '@/lib/rental/collection-point';
import { isPushConfigured } from '@/lib/push';
import { pushToUser } from '@/lib/push/to-user';
import { safeTrackingUrl } from '@/lib/delivery/customer-view';
import type { NotifyPort } from '@/lib/core/ports';
import type { OutboxMessage, RentalNoticeKind } from '@/lib/core/rental/notifications';
import { isMissingPipeline } from './repos';

/**
 * NotifyPort adapter and outbox dispatcher (spec §7.14).
 *
 * Outbox rows are written by the database in the same transaction as the
 * change they report. This module delivers them: in-app notification, email,
 * or SMS. Messages carry amounts and dates only, never bank or identity
 * details. A refund notice says "initiated", "processed" or "failed", never
 * "refunded" before the provider confirms it.
 */

/** How to reach us, in every delivery message that may need it. WhatsApp only, never "call". */
export function deliveryContactLine(): string {
  const wa = STUDIO.whatsapp?.display;
  return `Questions or a problem? ${wa ? `WhatsApp us on ${wa} or email` : 'Email'} ${STUDIO.email}.`;
}

/**
 * The "on the way" email (one per outbound leg). Its facts are read when it
 * is sent (noticeData), so it carries what the courier reported by then:
 * driver's first name, the live tracking link and the drop-off PIN. The
 * address is the renter's own, sent to the renter only.
 */
export function onTheWayText(data: OutboxMessage['data']): { title: string; body: string } {
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const driver = str(data.driverName);
  const address = str(data.address);
  const pin = str(data.pin);
  const url = str(data.trackingUrl);
  const lines = [
    `${driver ? `${driver}, your driver,` : 'Your driver'} is bringing your gear to ${address ?? 'the address you gave at checkout'}.`,
    pin ? `Your PIN for the driver: ${pin}. Give it only when they hand you the gear.${data.pinTexted === true ? ' Uber also sends it to you by SMS.' : ''}` : null,
    url ? `Follow the driver live: ${url}` : null,
    'Have the ID you verified with ready: the driver checks it before handing over.',
    deliveryContactLine(),
  ];
  return { title: 'Your gear is on the way', body: lines.filter((l): l is string => !!l).join('\n\n') };
}

/**
 * In-app delivery updates that also go to the renter's phone at once as a
 * push. They are service messages about a live delivery, so they skip the
 * engagement queue (and its caps); the bell's own push for the same
 * notification is then marked sent, so the phone gets it once.
 */
export const DELIVERY_PUSH_KINDS: ReadonlySet<RentalNoticeKind> = new Set<RentalNoticeKind>([
  'delivery_courier_assigned',
  'delivery_collected',
  'delivery_in_transit',
  'delivery_delivered',
  'delivery_attempt_failed',
  'delivery_cancelled',
  'delivery_return_courier_assigned',
  'delivery_return_collected',
]);

const money = (cents: unknown): string => (typeof cents === 'number' && Number.isFinite(cents) ? formatRand(cents / 100, { decimals: cents % 100 !== 0 }) : '');

/** Wording for each notice. Pure, so it is tested. */
export function rentalNoticeText(kind: RentalNoticeKind, data: OutboxMessage['data']): { title: string; body: string } {
  const amount = money(data.amountCents);
  switch (kind) {
    case 'payment_received':
      return { title: 'Payment received', body: `We received your payment of ${amount}. Your booking is confirmed.` };
    // Collection details are in the message itself: the checkout page tells the
    // renter "you get a message with the collection details".
    case 'booking_confirmed':
      return data.delivery === true
        ? { title: 'Booking confirmed', body: `Your gear hire is confirmed. Delivery updates are on your booking. Have the ID you verified with ready when the gear arrives.` }
        : {
            title: 'Booking confirmed',
            body: `Your gear hire is confirmed. Collect it on your start date at ${collectionPointWithCity()} (${STUDIO.hours.weekday}, ${STUDIO.hours.weekend}). Bring the ID you verified with; we check it and the gear with you at handover.`,
          };
    case 'collection_reminder':
      return {
        title: 'Collection today',
        body: `Your gear is ready for collection today at ${collectionPointWithCity()} (${STUDIO.hours.weekday}, ${STUDIO.hours.weekend}). Please bring the ID you verified with.`,
      };
    case 'handover_completed':
      return { title: 'Gear handed over', body: `Your hire has started. The condition photos and agreement are saved on your booking.` };
    case 'return_reminder':
      return { title: 'Return due tomorrow', body: `Your gear is due back by the end of tomorrow.` };
    case 'overdue_reminder':
      return {
        title: 'Your gear is overdue',
        body: `Your hire ended and the gear has not been returned yet. Please return it as soon as possible or contact us${STUDIO.whatsapp?.display ? ` on ${STUDIO.whatsapp.display}` : ''}. Any late fee follows the published rule.`,
      };
    case 'return_recorded':
      return { title: 'Return recorded', body: `We have recorded your return. We will inspect the gear and settle your deposit.` };
    case 'inspection_completed':
      return { title: 'Inspection complete', body: `Your returned gear has been inspected. Your deposit settlement is on your booking.` };
    case 'refund_initiated':
      return { title: 'Refund initiated', body: `We have asked the payment provider to refund ${amount}. It is not complete yet; banks usually take a few working days.` };
    case 'refund_processed':
      return { title: 'Refund processed', body: `The payment provider has processed your refund of ${amount}.` };
    case 'refund_failed':
      return { title: 'Refund problem', body: `Your refund of ${amount} could not be completed automatically. We are looking into it and will contact you.` };
    case 'late_payment_refund':
      return {
        title: 'Payment received after your hold expired',
        body: `Your payment of ${amount} arrived after the reservation expired and the gear was no longer available. We will refund it in full.`,
      };
    case 'payout_scheduled':
      return { title: 'Earnings scheduled', body: `Your earnings of ${amount} are scheduled for payout after the hire is closed.` };
    case 'payout_completed':
      return { title: 'Earnings paid', body: `Your earnings of ${amount} have been sent to your bank account.` };
    case 'payout_failed':
      return { title: 'Payout problem', body: `Your payout of ${amount} could not be completed. We are looking into it.` };
    case 'dispute_opened':
      return { title: 'Dispute opened', body: `A dispute was opened on your booking. A member of our team will review it.` };
    case 'dispute_resolved':
      return { title: 'Dispute resolved', body: `The dispute on your booking has been resolved. The outcome is on your booking.` };
    // Phase 4 delivery notices. Never a courier name, ETA or address we were not given,
    // and never the full delivery address (spec §4.17, §4.19), except the renter's own
    // drop-off address in their "on the way" email (owner, 2026-10-14).
    case 'delivery_quote_ready':
      return { title: 'Delivery quote ready', body: `Your delivery quote is ${amount}. It is held for a short time; the final price is confirmed before you pay.` };
    case 'delivery_booked':
      return { title: 'Delivery booked', body: `Your delivery is booked. We will update you when the gear is collected.` };
    case 'delivery_courier_assigned':
      return { title: 'Driver assigned', body: `A driver has been assigned to your delivery. Your PIN for the driver and the live tracking link are on your booking.` };
    case 'delivery_courier_at_pickup':
      return { title: 'Driver at pickup', body: `The driver has arrived to collect your gear.` };
    case 'delivery_collected':
      return { title: 'Gear collected', body: `The driver has collected your gear.` };
    case 'delivery_in_transit':
      return { title: 'Gear on the way', body: `Your gear is on the way. Have your PIN and the ID you verified with ready.` };
    case 'delivery_on_the_way':
      return onTheWayText(data);
    case 'delivery_delivered':
      return {
        title: 'Please confirm your delivery',
        body: `The driver reports your gear delivered. Please check every item and accessory and confirm receipt, or report a problem, on your booking.`,
      };
    case 'delivery_attempt_failed':
      return { title: 'Delivery attempt failed', body: `The driver could not complete the delivery. We will contact you to arrange the next step.` };
    case 'delivery_return_reminder':
      return { title: 'Return pickup reminder', body: `Your return pickup is coming up. Please have all items and accessories packed and ready.` };
    case 'delivery_return_courier_assigned':
      return { title: 'Return driver assigned', body: `A driver has been assigned to collect your return.` };
    case 'delivery_return_collected':
      return {
        title: 'Return collected',
        body: `The driver has collected your return. Your deposit is settled only after the gear is received and inspected.`,
      };
    case 'delivery_returned_for_inspection':
      return { title: 'Gear received back', body: `Your returned gear has arrived and is waiting for inspection.` };
    case 'delivery_incident':
      return { title: 'Delivery issue reported', body: `An issue was recorded on your delivery. Our team is looking into it and will contact you. Nothing has been decided yet.` };
    case 'delivery_cancelled':
      return { title: 'Delivery cancelled', body: `Your delivery was cancelled. Any refund due is shown on your booking.` };
    case 'delivery_fee_refund':
      return { title: 'Delivery fee refund', body: `We will refund ${amount} of your delivery fee. It is not complete until the payment provider processes it.` };
    // Phase 8: to the OWNER whose address the gear is collected from and returned to.
    // Never the renter's name, address or contact, and never our driver's route.
    case 'owner_pickup_scheduled':
      return {
        title: data.leg === 'return' ? 'Return to you booked' : 'Collection from you booked',
        body:
          data.leg === 'return'
            ? `Our driver will bring your gear back to your pickup address at the end of the hire. The time is on Listings, under Pickups from your address.`
            : `Our driver will collect your gear from your pickup address for a hire. The time is on Listings, under Pickups from your address. Please have it packed, with every accessory, and hand it over in person.`,
      };
    case 'owner_pickup_collected':
      return { title: 'Gear collected from you', body: `Our driver has collected your gear from your pickup address.` };
    case 'owner_gear_returned':
      return {
        title: 'Your gear is back: please confirm',
        body: `Our driver has brought your gear back to your pickup address. Please check every item and accessory and confirm receipt and condition, or report a problem, on Listings. Your payout waits for this.`,
      };
    case 'staff_alert':
      return {
        title: 'Rental needs attention',
        body: `${String(data.what ?? 'alert').replace(/_/g, ' ')}${data.reference ? ` (${String(data.reference)})` : ''}. See Rental ops.`,
      };
  }
}

function linkFor(m: OutboxMessage): string {
  if (m.kind === 'staff_alert') return '/admin/rental-ops';
  if (m.kind === 'owner_pickup_scheduled' || m.kind === 'owner_pickup_collected' || m.kind === 'owner_gear_returned') return '/dashboard/listings#owner-pickups';
  return m.bookingIds[0] ? `/dashboard/bookings/${m.bookingIds[0]}` : '/dashboard/bookings';
}

/**
 * Facts a notice's words depend on that are read when it is sent. "Booking
 * confirmed" says collection or delivery from the booking's fulfilment_method,
 * the same field the collection reminder uses (lib/rental/workers.ts), never
 * from whether a delivery fee was charged.
 */
export async function noticeData(
  db: Pick<ReturnType<typeof createAdminClient>, 'from'>,
  m: Pick<OutboxMessage, 'kind' | 'bookingIds' | 'data'>,
): Promise<OutboxMessage['data']> {
  if (m.kind === 'delivery_on_the_way' && m.bookingIds.length > 0) return onTheWayData(db, m);
  if (m.kind !== 'booking_confirmed' || m.bookingIds.length === 0) return m.data;
  const { data, error } = await db.from('equipment_bookings').select('fulfilment_method').in('id', m.bookingIds);
  // Never guess "collection" on a failed read: the delivery is retried instead.
  if (error) throw new Error(`fulfilment lookup failed: ${error.message}`);
  const delivery = ((data ?? []) as { fulfilment_method?: string | null }[]).some((b) => b.fulfilment_method === 'delivery');
  return { ...m.data, delivery };
}

/**
 * Facts for the "on the way" email, read when it is sent: the latest
 * outbound leg for these bookings. No tracking link on a leg from an owner's
 * address (the courier's page shows that point, D-88). A redacted address is
 * never shown. A failed read is retried, never sent half-empty.
 */
async function onTheWayData(
  db: Pick<ReturnType<typeof createAdminClient>, 'from'>,
  m: Pick<OutboxMessage, 'bookingIds' | 'data'>,
): Promise<OutboxMessage['data']> {
  const { data, error } = await db
    .from('delivery_shipments')
    .select('provider, tracking_url, courier_name, recipient_pin, destination_address_id, origin_owner_id')
    .eq('leg', 'outbound')
    .overlaps('booking_ids', m.bookingIds)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`shipment lookup failed: ${error.message}`);
  const s = ((data ?? []) as Record<string, unknown>[])[0];
  if (!s) return m.data;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  let address: string | null = null;
  const addressId = str(s.destination_address_id);
  if (addressId) {
    const a = await db.from('delivery_addresses').select('formatted_address, redacted_at').eq('id', addressId).maybeSingle();
    if (a.error) throw new Error(`address lookup failed: ${a.error.message}`);
    const row = a.data as { formatted_address?: string | null; redacted_at?: string | null } | null;
    if (row && !row.redacted_at) address = str(row.formatted_address);
  }
  const pin = str(s.recipient_pin);
  return {
    ...m.data,
    driverName: str(s.courier_name),
    address,
    pin,
    pinTexted: !!pin && s.provider === 'uber_direct',
    trackingUrl: str(s.origin_owner_id) ? null : safeTrackingUrl(str(s.tracking_url)),
  };
}

/**
 * Push one delivery update to the renter's phone now, and mark the bell's
 * queued push for the same notification as sent (087 queues one per bell
 * item), so it arrives once. A push is a nicety: it never fails the notice.
 */
async function pushDeliveryUpdate(
  db: ReturnType<typeof createAdminClient>,
  rows: { id: string; user_id: string }[],
  payload: { title: string; body: string; url: string; tag: string },
): Promise<void> {
  if (!isPushConfigured()) return;
  for (const r of rows) {
    try {
      const sent = await pushToUser(db, r.user_id, payload);
      if (sent.sent > 0) {
        await db
          .from('notification_outbox')
          .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
          .eq('dedupe_key', `engage_push:notification:${r.id}`)
          .eq('status', 'pending');
      }
    } catch (err) {
      console.error('[rental-notify] delivery push skipped:', err instanceof Error ? err.message : 'unknown error');
    }
  }
}

export const supabaseNotify: NotifyPort = {
  async deliver(m) {
    const db = createAdminClient();
    let facts: OutboxMessage['data'];
    try {
      facts = await noticeData(db, m);
    } catch (err) {
      return { ok: false, retryable: true, message: err instanceof Error ? err.message : 'notice data unavailable' };
    }
    const { title, body } = rentalNoticeText(m.kind, facts);
    const link = linkFor(m);

    if (m.channel === 'in_app') {
      let userIds = [m.userId];
      if (m.userId === 'staff') {
        const { data } = await db.from('profiles').select('id').eq('role', 'admin');
        userIds = (data ?? []).map((r) => (r as { id: string }).id);
        if (userIds.length === 0) return { ok: true };
      }
      const { data: inserted, error } = await db
        .from('notifications')
        .insert(userIds.map((user_id) => ({ user_id, type: `rental_${m.kind}`, title, body, link })))
        .select('id, user_id');
      if (error) return { ok: false, retryable: true, message: error.message };
      if (m.userId !== 'staff' && DELIVERY_PUSH_KINDS.has(m.kind)) {
        // One tag per booking: each update replaces the last on the phone instead of stacking.
        await pushDeliveryUpdate(db, (inserted ?? []) as { id: string; user_id: string }[], { title, body, url: link, tag: `delivery-${m.bookingIds[0] ?? 'update'}` });
      }
      return { ok: true };
    }

    if (m.userId === 'staff') return { ok: true };

    if (m.channel === 'email') {
      const { data } = await db.auth.admin.getUserById(m.userId);
      const to = data?.user?.email;
      if (!to) return { ok: false, retryable: false, message: 'no email address' };
      try {
        await emailProvider.sendEmail({
          to,
          subject: `${title} — ${STUDIO.name}`,
          text: `${body}\n\nYour booking: ${STUDIO.meta.url}${link}\n\n${STUDIO.name}`,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, retryable: true, message: err instanceof Error ? err.message : 'email failed' };
      }
    }

    // SMS: only to a verified number, and only when an SMS provider is configured.
    if (!sms.isConfigured()) return { ok: false, retryable: false, message: 'sms not configured' };
    const { data: profile } = await db.from('profiles').select('phone, phone_verified_at').eq('id', m.userId).maybeSingle();
    const p = profile as { phone?: string | null; phone_verified_at?: string | null } | null;
    if (!p?.phone || !p.phone_verified_at) return { ok: false, retryable: false, message: 'no verified phone' };
    const r = await sms.send(p.phone, `${STUDIO.name}: ${body}`);
    return r.ok ? { ok: true } : { ok: false, retryable: true, message: r.error ?? 'sms failed' };
  },
};

interface OutboxRow {
  id: string;
  dedupe_key: string;
  kind: RentalNoticeKind;
  channel: OutboxMessage['channel'];
  user_id: string;
  booking_ids: string[] | null;
  data: OutboxMessage['data'] | null;
  send_after: string | null;
}

/** Deliver due outbox messages. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function dispatchOutbox(limit = 100, port: NotifyPort = supabaseNotify): Promise<{ sent: number; skipped: number; failed: number }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc('claim_outbox', { p_limit: limit, p_max_attempts: 5 });
  if (error) {
    if (isMissingPipeline(error)) return { sent: 0, skipped: 0, failed: 0 };
    throw new Error(`claim_outbox failed: ${error.message}`);
  }
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of (data ?? []) as OutboxRow[]) {
    const message: OutboxMessage = {
      dedupeKey: row.dedupe_key,
      kind: row.kind,
      channel: row.channel,
      userId: row.user_id,
      bookingIds: row.booking_ids ?? [],
      data: row.data ?? {},
      sendAfter: row.send_after,
    };
    let result: Awaited<ReturnType<NotifyPort['deliver']>>;
    try {
      result = await port.deliver(message);
    } catch (err) {
      result = { ok: false, retryable: true, message: err instanceof Error ? err.message : 'deliver threw' };
    }
    if (result.ok) {
      sent += 1;
      await db.from('notification_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id);
    } else if (!result.retryable) {
      skipped += 1;
      await db.from('notification_outbox').update({ status: 'skipped', last_error: result.message.slice(0, 300) }).eq('id', row.id);
    } else {
      failed += 1;
      await db.from('notification_outbox').update({ status: 'failed', last_error: result.message.slice(0, 300) }).eq('id', row.id);
    }
  }
  return { sent, skipped, failed };
}
