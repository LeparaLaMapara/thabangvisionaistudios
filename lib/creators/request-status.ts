/**
 * Status changes a person may make to a crew request through
 * PATCH /api/creator-requests/[id]. Pure, tested in
 * tests/unit/security-2026-10-13.test.ts.
 *
 * `paid` is never set here: only a verified payment may set it (the payment
 * webhook). Until 2026-10-13 a creator could mark their own gig paid and then
 * completed with no payment at all.
 */

export type RequestActor = 'creator' | 'client';

const CREATOR_MOVES: Record<string, readonly string[]> = {
  pending: ['confirmed', 'declined', 'cancelled'],
  // Completing an unpaid gig only tells staff to check the payment before any
  // payout (no payout is ever automatic).
  confirmed: ['completed'],
  paid: ['in_progress'],
  in_progress: ['completed'],
};

const CLIENT_MOVES: Record<string, readonly string[]> = {
  pending: ['cancelled'],
};

export function canMoveRequest(actor: RequestActor, from: string, to: string): boolean {
  const moves = actor === 'creator' ? CREATOR_MOVES : CLIENT_MOVES;
  return (moves[from] ?? []).includes(to);
}
