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
] as const;

export type RentalNoticeKind = (typeof RENTAL_NOTICE_KINDS)[number];
export type NoticeChannel = 'in_app' | 'email' | 'sms';

/** Which channels each kind goes to. SMS only where timing matters. */
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
  refund_failed: ['in_app', 'email'],
  payout_scheduled: ['in_app', 'email'],
  payout_completed: ['in_app', 'email'],
  payout_failed: ['in_app', 'email'],
  dispute_opened: ['in_app', 'email'],
  dispute_resolved: ['in_app', 'email'],
  late_payment_refund: ['in_app', 'email'],
  staff_alert: ['in_app'],
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
