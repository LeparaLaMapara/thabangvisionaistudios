import type { Finding } from '@/lib/ops/types';

/**
 * A service-booking refund left in 'pending' (claimed, no outcome recorded)
 * blocks every automatic refund and the creator payout, by design, so nothing
 * moves twice. Something must still tell a person, or the client is never
 * refunded. Before migration 073 an unclear provider answer is also stored as
 * 'pending' (with an OUTCOME UNKNOWN note); both need the same check of the
 * provider, so both are reported.
 */
export interface PendingServiceRefundRow {
  id: string;
  reference: string | null;
  updatedAt: string | null;
  amount: number | null;
  note: string | null;
}

/** How long a claim may sit before it counts as stuck: the send and record take seconds. */
export const STUCK_REFUND_AFTER_MINUTES = 15;

export function detectStuckServiceRefunds(rows: PendingServiceRefundRow[], now: Date): Finding[] {
  const cutoff = now.getTime() - STUCK_REFUND_AFTER_MINUTES * 60_000;
  return rows
    .filter((r) => !r.updatedAt || new Date(r.updatedAt).getTime() <= cutoff)
    .map((r) => ({
      checkId: 'service-refund-stuck',
      severity: 'critical' as const,
      entityType: 'booking',
      entityId: r.id,
      title: `Service refund with no recorded outcome: ${r.reference ?? r.id}`,
      detail: {
        summary: 'A refund was claimed but no outcome was recorded (or the provider did not answer clearly). Check the payment provider\'s refunds for this payment reference, then record what happened. Nothing will be refunded or paid out automatically until then.',
        amount: r.amount,
        since: r.updatedAt,
        unknownOutcome: Boolean(r.note && /OUTCOME UNKNOWN/.test(r.note)),
      },
    }));
}
