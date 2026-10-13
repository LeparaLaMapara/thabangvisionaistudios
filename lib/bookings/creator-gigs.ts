/**
 * How a creator's service bookings are grouped on the gigs page. Pure, so
 * it is tested. Cancelled and declined jobs used to fall into no group and
 * simply vanished; they now go to "Past" with the reason.
 */

export interface GroupableGig {
  status: string;
  accepted_at?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
  cancellation_reason?: string | null;
}

export interface CreatorGigGroups<T extends GroupableGig> {
  /** Paid, waiting for the creator to accept or decline. */
  actionable: T[];
  /** Accepted, delivered or disputed. */
  active: T[];
  /** Approved (payout due or sent). */
  completed: T[];
  /** Cancelled or declined. */
  past: T[];
}

export function splitCreatorGigs<T extends GroupableGig>(gigs: readonly T[]): CreatorGigGroups<T> {
  const groups: CreatorGigGroups<T> = { actionable: [], active: [], completed: [], past: [] };
  for (const g of gigs) {
    if (g.status === 'paid') groups.actionable.push(g);
    else if (g.status === 'accepted' || g.status === 'delivered' || g.status === 'disputed') groups.active.push(g);
    else if (g.status === 'completed' || g.status === 'paid_out') groups.completed.push(g);
    else if (g.status === 'cancelled' || g.status === 'declined') groups.past.push(g);
  }
  return groups;
}

/** One plain line on why a past job ended. */
export function pastGigReason(g: GroupableGig): string {
  // Before migration 073 a decline is stored as a cancellation "Declined by creator: ..."
  const cancelNote = (g.cancellation_reason ?? '').trim();
  const declined = g.status === 'declined' || Boolean(g.declined_at) || /^declined by creator/i.test(cancelNote);
  if (declined) {
    const why = (g.decline_reason ?? cancelNote.replace(/^declined by creator:?\s*/i, '')).trim();
    return why ? `You declined it: ${why}. The client was refunded.` : 'You declined it. The client was refunded.';
  }
  return cancelNote ? `Cancelled: ${cancelNote}` : 'Cancelled. You do not need to do anything.';
}
