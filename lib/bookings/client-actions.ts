import { SERVICE_RULES, canRaiseServiceDispute, hasBeenDelivered, revisionsAllowed } from '@/lib/core/services/fulfilment';

/**
 * What a client can do on a shoot booking right now, from the same rules the
 * server enforces (lib/core/services/fulfilment.ts). Pure, so it is tested.
 *
 * Before Phase 5 a client looking at delivered work had one button, "Approve".
 * The booking promised "approve, ask for a revision or raise a problem", and
 * the server supported all three, but the page offered only the one that pays
 * the creator.
 */

export interface ClientBookingFacts {
  status: string;
  delivered_at?: string | null;
  delivery_url?: string | null;
  revisions_used?: number | null;
  revisions_included?: number | null;
  dispute_window_ends_at?: string | null;
  completed_at?: string | null;
  payout_status?: string | null;
  client_rating?: number | null;
}

export interface ClientActions {
  approve: boolean;
  /** Revision rounds still available (0 = none left, or not the moment for one). */
  changesLeft: number;
  report: boolean;
  cancel: boolean;
  rate: boolean;
}

export function clientServiceActions(b: ClientBookingFacts, now: Date): ClientActions {
  const delivered = b.status === 'delivered';
  const used = Math.max(0, b.revisions_used ?? 0);
  const changesLeft = delivered ? Math.max(0, revisionsAllowed(b.revisions_included) - used) : 0;
  const everDelivered = hasBeenDelivered({ deliveredAt: b.delivered_at ?? null, deliveryUrl: b.delivery_url ?? null, revisionsUsed: b.revisions_used ?? null });
  return {
    approve: SERVICE_RULES.approve_delivery.from.includes(b.status as never),
    changesLeft,
    report: canRaiseServiceDispute(
      { status: b.status, disputeWindowEndsAt: b.dispute_window_ends_at ?? null, completedAt: b.completed_at ?? null, payoutStatus: b.payout_status ?? null },
      now,
    ),
    cancel: SERVICE_RULES.cancel.from.includes(b.status as never) && !everDelivered,
    rate: b.status === 'completed' && !b.client_rating,
  };
}
