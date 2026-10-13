/**
 * One timeline for a photographer or videographer booking, the same for the
 * client and the creator (TASK-069): Booked, Paid, Confirmed, Arrived,
 * Delivered, Approved, Creator paid, Reviewed. Pure, so it is tested.
 */

import { STUDIO } from '@/lib/constants';

export interface TimelineBooking {
  status: string;
  created_at: string;
  paid_at?: string | null;
  payment_status?: string | null;
  accepted_at?: string | null;
  arrived_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  payout_status?: string | null;
  client_rating?: number | null;
}

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped' | 'stopped';

export interface TimelineStep {
  key: string;
  label: string;
  /** What it means, in plain words, for whoever is looking (once it has happened). */
  detail: string;
  /** While this is the current step: what we are waiting for, and who acts. */
  next: string;
  at: string | null;
  state: StepState;
}

export function shootTimeline(b: TimelineBooking, viewer: 'client' | 'creator'): TimelineStep[] {
  const days = STUDIO.booking.autoApproveDeliveryAfterDays;
  const hours = STUDIO.booking.payoutDelayHours;
  const client = viewer === 'client';
  const paid = b.payment_status === 'paid' || Boolean(b.paid_at);
  const approved = b.status === 'completed' || Boolean(b.completed_at);
  const steps: Omit<TimelineStep, 'state'>[] = [
    { key: 'booked', label: 'Booked', at: b.created_at, detail: 'Reserved. It is confirmed once payment is received.', next: 'Reserved. It is confirmed once payment is received.' },
    {
      key: 'paid', label: 'Paid', at: paid ? (b.paid_at ?? null) : null,
      detail: client ? `Payment received by ${STUDIO.name}.` : `The client has paid ${STUDIO.name}.`,
      next: client ? 'Waiting for your payment. The booking is confirmed once it is received.' : 'Waiting for the client to pay. You do not need to do anything yet.',
    },
    {
      key: 'confirmed', label: 'Creator confirmed', at: b.accepted_at ?? null,
      detail: client ? 'Your creator has accepted the date.' : 'You accepted the booking.',
      next: client
        ? 'Waiting for your creator to accept the date. If they cannot take it, you are refunded in full and offered another creator.'
        : 'Accept or decline this booking. If you decline, the client is refunded in full.',
    },
    {
      key: 'arrived', label: 'Arrived', at: b.arrived_at ?? null,
      detail: client ? 'Your creator checked in on the day.' : 'Tap "I’m here" when you arrive.',
      next: client ? 'Your creator checks in on the day of the shoot.' : 'Tap "I’m here" when you arrive.',
    },
    {
      key: 'delivered', label: 'Delivered', at: b.delivered_at ?? null,
      detail: client ? 'Your photos or video are ready to review.' : 'Share the finished work here.',
      next: client ? 'Your creator shares the finished work here, and we let you know.' : 'Share the finished work here when it is ready.',
    },
    {
      key: 'approved', label: 'Approved', at: approved ? (b.completed_at ?? null) : null,
      detail: client ? 'You approved the work.' : 'The client approved the work.',
      next: client
        ? `Review the work, then approve it, ask for changes or report a problem. If we hear nothing within ${days} days, it is approved automatically.`
        : `Waiting for the client to approve. If they do not answer within ${days} days, it is approved automatically.`,
    },
    {
      key: 'payout', label: 'Creator paid', at: null,
      detail: client ? 'The creator has been paid.' : 'Paid to your bank account.',
      next: client
        ? `The creator is paid ${hours} hours after approval, as long as no problem has been raised.`
        : `Your payout is sent ${hours} hours after approval, as long as no problem has been raised. When it reaches your account depends on your bank.`,
    },
    {
      key: 'review', label: 'Reviewed', at: null,
      detail: 'A short review helps the next client choose.',
      next: client ? 'A short review helps the next client choose.' : 'The client may leave a review.',
    },
  ];

  const done = new Set<string>(['booked']);
  if (paid) done.add('paid');
  if (b.accepted_at) done.add('confirmed');
  if (b.arrived_at) done.add('arrived');
  if (b.delivered_at || b.status === 'delivered') done.add('delivered');
  if (approved) done.add('approved');
  if (b.payout_status === 'paid' || b.status === 'paid_out') done.add('payout');
  if (b.client_rating) done.add('review');
  // Later steps imply earlier ones, except "Arrived", which is only ever
  // shown done when the creator really checked in; otherwise it is skipped.
  // "Creator paid" is never implied either: a review after approval used to
  // mark the payout done, so the creator saw "All done." while it was still
  // pending. It stays the current step until the payout is really sent.
  const order = steps.map((s) => s.key);
  const last = Math.max(...order.map((k, i) => (done.has(k) ? i : -1)));
  const skipped = new Set<string>();
  order.slice(0, last + 1).forEach((k) => {
    if (done.has(k) || k === 'payout') return;
    if (k === 'arrived') skipped.add(k);
    else done.add(k);
  });

  const stopped = b.status === 'cancelled' || b.status === 'declined';
  let currentMarked = false;
  return steps.map((s) => {
    if (done.has(s.key)) return { ...s, state: 'done' as const };
    if (skipped.has(s.key)) return { ...s, state: 'skipped' as const };
    if (stopped) return { ...s, state: 'stopped' as const };
    if (!currentMarked) {
      currentMarked = true;
      return { ...s, state: 'current' as const };
    }
    return { ...s, state: 'upcoming' as const };
  });
}
