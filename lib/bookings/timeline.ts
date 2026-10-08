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
  /** What it means, in plain words, for whoever is looking. */
  detail: string;
  at: string | null;
  state: StepState;
}

export function shootTimeline(b: TimelineBooking, viewer: 'client' | 'creator'): TimelineStep[] {
  const paid = b.payment_status === 'paid' || Boolean(b.paid_at);
  const approved = b.status === 'completed' || Boolean(b.completed_at);
  const steps: Omit<TimelineStep, 'state'>[] = [
    { key: 'booked', label: 'Booked', at: b.created_at, detail: 'Reserved. It is confirmed once payment is received.' },
    { key: 'paid', label: 'Paid', at: paid ? (b.paid_at ?? null) : null, detail: viewer === 'client' ? `Payment received by ${STUDIO.name}.` : `The client has paid ${STUDIO.name}.` },
    {
      key: 'confirmed', label: 'Creator confirmed', at: b.accepted_at ?? null,
      detail: viewer === 'client' ? 'Your creator has accepted the date.' : 'You accepted the booking.',
    },
    {
      key: 'arrived', label: 'Arrived', at: b.arrived_at ?? null,
      detail: viewer === 'client' ? 'Your creator checked in on the day.' : 'Tap "I’m here" when you arrive.',
    },
    {
      key: 'delivered', label: 'Delivered', at: b.delivered_at ?? null,
      detail: viewer === 'client' ? 'Your photos or video are ready to review.' : 'Share the finished work here.',
    },
    {
      key: 'approved', label: 'Approved', at: approved ? (b.completed_at ?? null) : null,
      detail: viewer === 'client'
        ? 'Approving confirms the work is complete. Tell us within 7 days if something is wrong; after 7 days it is approved automatically.'
        : 'The client approves, or it is approved automatically after 7 days.',
    },
    {
      key: 'payout', label: 'Creator paid', at: null,
      detail: viewer === 'creator' ? 'Paid to your bank account after approval.' : 'The creator is paid only after approval.',
    },
    { key: 'review', label: 'Reviewed', at: null, detail: 'A short review helps the next client choose.' },
  ];

  const done = new Set<string>(['booked']);
  if (paid) done.add('paid');
  if (b.accepted_at) done.add('confirmed');
  if (b.arrived_at) done.add('arrived');
  if (b.delivered_at || b.status === 'delivered') done.add('delivered');
  if (approved) done.add('approved');
  if (b.payout_status === 'paid') done.add('payout');
  if (b.client_rating) done.add('review');
  // Later steps imply earlier ones, except "Arrived", which is only ever
  // shown done when the creator really checked in; otherwise it is skipped.
  const order = steps.map((s) => s.key);
  const last = Math.max(...order.map((k, i) => (done.has(k) ? i : -1)));
  const skipped = new Set<string>();
  order.slice(0, last + 1).forEach((k) => {
    if (done.has(k)) return;
    if (k === 'arrived') skipped.add(k);
    else done.add(k);
  });

  const stopped = b.status === 'cancelled';
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
