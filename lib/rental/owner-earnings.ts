import { RENTAL_POLICY } from '@/lib/constants';

/**
 * "Hires and earnings" for a gear owner. Pure, so it is tested.
 *
 * Before Phase 5 an owner learnt that their gear was hired only from a
 * payout notice after the hire ("Earnings scheduled ... after the hire is
 * closed"), and could not see when a payout was due or why one was held.
 *
 * Shows the owner's own share and the hire's stage, never anything about the
 * renter (no name, contact or address). Payout words state when WE send a
 * payout, never when it arrives (that is up to the bank), and that a person
 * approves each payout (D-19/D-24: auto-approval is off).
 */

export interface OwnerHireFacts {
  id: string;
  rental_title: string | null;
  start_date: string;
  end_date: string;
  status: string;
  owner_share_cents: number | null;
  completed_at: string | null;
}

export interface OwnerPayoutFacts {
  booking_id: string;
  state: string;
  owner_amount_cents: number;
  scheduled_at: string | null;
  completed_at: string | null;
}

export interface OwnerHireView {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  stage: string;
  shareCents: number | null;
  payout: { text: string; tone: 'waiting' | 'done' | 'attention' } | null;
}

const STAGE: Readonly<Record<string, string>> = {
  confirmed: 'Booked',
  active: 'On hire',
  overdue: 'Overdue: we are following up with the renter',
  return_pending: 'Returned, being inspected',
  return_reviewed: 'Inspected',
  completed: 'Completed',
  disputed: 'Under review by our team',
};

/** The hire stages an owner sees (unpaid holds and cancellations are not hires). */
export const OWNER_VISIBLE_STATUSES = Object.keys(STAGE);

const date = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' });

export function payoutWords(p: OwnerPayoutFacts): { text: string; tone: 'waiting' | 'done' | 'attention' } {
  switch (p.state) {
    case 'success':
      return { text: `Paid${p.completed_at ? ` on ${date(p.completed_at)}` : ''}. When it shows in your account depends on your bank.`, tone: 'done' };
    case 'scheduled':
      return { text: `Scheduled${p.scheduled_at ? ` from ${date(p.scheduled_at)}` : ''}, after a final check by our team.`, tone: 'waiting' };
    case 'approved':
    case 'claimed':
    case 'pending':
    case 'otp':
    case 'received':
      return { text: 'Approved and being sent to your bank.', tone: 'waiting' };
    default:
      // held, blocked, failed, reversed, rejected, abandoned, needs_attention
      return { text: 'On hold: a person on our team is looking into it. Check that your payout account is validated.', tone: 'attention' };
  }
}

export function ownerHireViews(hires: OwnerHireFacts[], payouts: OwnerPayoutFacts[]): OwnerHireView[] {
  const byBooking = new Map(payouts.map((p) => [p.booking_id, p]));
  return hires
    .filter((h) => OWNER_VISIBLE_STATUSES.includes(h.status))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((h) => {
      const p = byBooking.get(h.id);
      let payout: OwnerHireView['payout'] = p ? payoutWords(p) : null;
      if (!p && h.status === 'completed') {
        payout = { text: `Your payout is scheduled ${RENTAL_POLICY.ownerPayoutDelayHours} hours after a clean completion, after a final check by our team.`, tone: 'waiting' };
      } else if (!p && h.status === 'disputed') {
        payout = { text: 'Your payout waits until the review is resolved.', tone: 'attention' };
      }
      return {
        id: h.id,
        title: h.rental_title ?? 'Your gear',
        startDate: h.start_date,
        endDate: h.end_date,
        stage: STAGE[h.status] ?? h.status,
        shareCents: p ? p.owner_amount_cents : h.owner_share_cents,
        payout,
      };
    });
}
