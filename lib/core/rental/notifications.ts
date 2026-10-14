/**
 * Rental notifications (spec §7.14). Pure.
 *
 * Notifications are written to an outbox in the same database transaction as
 * the change they report. So a rolled-back change never notifies anyone, and
 * the dedupe key means a replayed event never sends a second copy (T28).
 */

export const RENTAL_NOTICE_KINDS = [
  'payment_received',
  'booking_confirmed',
  'collection_reminder',
  'handover_completed',
  'return_reminder',
  'overdue_reminder',
  'return_recorded',
  'inspection_completed',
  'refund_initiated',
  'refund_processed',
  'refund_failed',
  'payout_scheduled',
  'payout_completed',
  'payout_failed',
  'dispute_opened',
  'dispute_resolved',
  'late_payment_refund',
  'staff_alert',
  // Phase 4 delivery notices (spec §4.19). Sent only from real events: a
  // verified provider update, a staff action or a renter confirmation.
  'delivery_quote_ready',
  'delivery_booked',
  'delivery_courier_assigned',
  'delivery_courier_at_pickup',
  'delivery_collected',
  'delivery_in_transit',
  // One email when the gear starts moving (driver assigned, collected or on
  // the way: whichever comes first): tracking link, PIN, drop-off address,
  // driver's first name and who to contact. Email only; the in-app updates
  // above also go to the phone as push.
  'delivery_on_the_way',
  'delivery_delivered',
  'delivery_attempt_failed',
  'delivery_return_reminder',
  'delivery_return_courier_assigned',
  'delivery_return_collected',
  'delivery_returned_for_inspection',
  'delivery_incident',
  'delivery_cancelled',
  'delivery_fee_refund',
  // Phase 8 owner pickup notices (to the OWNER of the gear, never renter
  // details): a collection from their address is booked, the driver collected
  // it, and the gear is back at their address (please confirm receipt).
  'owner_pickup_scheduled',
  'owner_pickup_collected',
  'owner_gear_returned',
] as const;

export type RentalNoticeKind = (typeof RENTAL_NOTICE_KINDS)[number];
export type NoticeChannel = 'in_app' | 'email' | 'sms';

/**
 * Which channels each kind goes to. SMS only where timing matters. Every
 * in_app delivery update is also pushed to the renter's phone straight away
 * (lib/rental/notify.ts, DELIVERY_PUSH_KINDS).
 */
export const NOTICE_CHANNELS: Record<RentalNoticeKind, readonly NoticeChannel[]> = {
  payment_received: ['in_app', 'email'],
  booking_confirmed: ['in_app', 'email'],
  collection_reminder: ['in_app', 'email', 'sms'],
  handover_completed: ['in_app', 'email'],
  return_reminder: ['in_app', 'email', 'sms'],
  overdue_reminder: ['in_app', 'email', 'sms'],
  return_recorded: ['in_app', 'email'],
  inspection_completed: ['in_app', 'email'],
  refund_initiated: ['in_app', 'email'],
  refund_processed: ['in_app', 'email'],
  // The renter must act (add bank details), so every channel, SMS included.
  refund_failed: ['in_app', 'email', 'sms'],
  payout_scheduled: ['in_app', 'email'],
  payout_completed: ['in_app', 'email'],
  payout_failed: ['in_app', 'email'],
  dispute_opened: ['in_app', 'email'],
  dispute_resolved: ['in_app', 'email'],
  late_payment_refund: ['in_app', 'email'],
  staff_alert: ['in_app'],
  delivery_quote_ready: ['in_app'],
  delivery_booked: ['in_app', 'email'],
  delivery_courier_assigned: ['in_app'],
  delivery_courier_at_pickup: ['in_app'],
  delivery_collected: ['in_app'],
  delivery_in_transit: ['in_app'],
  delivery_on_the_way: ['email'],
  delivery_delivered: ['in_app', 'email', 'sms'],
  delivery_attempt_failed: ['in_app', 'email', 'sms'],
  delivery_return_reminder: ['in_app', 'email', 'sms'],
  delivery_return_courier_assigned: ['in_app'],
  delivery_return_collected: ['in_app', 'email'],
  delivery_returned_for_inspection: ['in_app', 'email'],
  delivery_incident: ['in_app', 'email'],
  delivery_cancelled: ['in_app', 'email'],
  delivery_fee_refund: ['in_app', 'email'],
  owner_pickup_scheduled: ['in_app', 'email'],
  owner_pickup_collected: ['in_app'],
  owner_gear_returned: ['in_app', 'email', 'sms'],
};

export interface OutboxMessage {
  dedupeKey: string;
  kind: RentalNoticeKind;
  channel: NoticeChannel;
  userId: string;
  /** Booking ids the message is about; the link goes to the first. */
  bookingIds: string[];
  /** Small, non-sensitive facts for the template (amounts in cents, dates). Never bank or ID data. */
  data: Record<string, string | number | boolean | null>;
  sendAfter: string | null;
}

/**
 * One outbox row per channel. `discriminator` separates legitimate repeats.
 * For example, one overdue reminder per escalation stage, or one refund
 * notice per refund obligation.
 */
export function buildNotices(p: {
  kind: RentalNoticeKind;
  userId: string;
  bookingIds: string[];
  discriminator: string;
  data?: OutboxMessage['data'];
  sendAfter?: Date | null;
  channels?: readonly NoticeChannel[];
}): OutboxMessage[] {
  const channels = p.channels ?? NOTICE_CHANNELS[p.kind];
  return channels.map((channel) => ({
    dedupeKey: `${p.kind}:${channel}:${p.userId}:${p.discriminator}`,
    kind: p.kind,
    channel,
    userId: p.userId,
    bookingIds: p.bookingIds,
    data: p.data ?? {},
    sendAfter: p.sendAfter ? p.sendAfter.toISOString() : null,
  }));
}

/** 07:45 South African time (UTC+2, no daylight saving) on a given date. */
export function collectionReminderAt(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`date must be YYYY-MM-DD (got ${date})`);
  return new Date(`${date}T05:45:00.000Z`);
}

/** Today's date in South Africa, YYYY-MM-DD. */
export function sastDate(now: Date): string {
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}
