import type { Finding } from '@/lib/ops/types';

/**
 * Rental-pipeline invariants (spec §12 "Required alerts"). Pure detectors:
 * rows in, findings out. The gather half is lib/rental/reconcile-server.ts.
 * Each one stays quiet on healthy data. The tests prove the negatives.
 */

const HOUR = 3_600_000;

const ADVANCED = new Set(['confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'completed', 'disputed']);

export interface IntentRow {
  reference: string;
  state: string;
  paidAt: string | null;
  lineStatuses: string[];
  updatedAt: string;
}

/** Payment received but booking not confirmed. Also money held that is owed back. */
export function detectIntentProblems(rows: readonly IntentRow[], now: Date, graceMinutes = 15): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (r.state === 'paid' && r.paidAt && now.getTime() - new Date(r.paidAt).getTime() > graceMinutes * 60_000 && !r.lineStatuses.some((s) => ADVANCED.has(s))) {
      out.push({ checkId: 'rental-paid-not-confirmed', severity: 'critical', entityType: 'rental_payment_intent', entityId: r.reference, title: 'Payment received but the booking was not confirmed', detail: { lines: r.lineStatuses } });
    }
    if ((r.state === 'mismatch' || r.state === 'refund_due') && now.getTime() - new Date(r.updatedAt).getTime() > HOUR) {
      out.push({ checkId: 'rental-unallocated-money', severity: 'critical', entityType: 'rental_payment_intent', entityId: r.reference, title: r.state === 'mismatch' ? 'Payment did not match the order and needs a person' : 'Payment is owed back to the customer', detail: { state: r.state } });
    }
  }
  return out;
}

export interface ConfirmedLineRow {
  id: string;
  status: string;
  paymentMethod: string | null;
  paymentReference: string | null;
}

/** Confirmed booking without a matching payment. Manual payments carry a "manual:" reference; cash and EFT orders are paid at the counter. */
export function detectConfirmedWithoutPayment(rows: readonly ConfirmedLineRow[]): Finding[] {
  return rows
    .filter((r) => ADVANCED.has(r.status) && r.paymentMethod === 'online' && !r.paymentReference)
    .map((r) => ({ checkId: 'rental-confirmed-unpaid', severity: 'critical' as const, entityType: 'equipment_booking', entityId: r.id, title: 'Booking confirmed without a recorded payment', detail: { status: r.status } }));
}

export interface ObligationRow {
  id: string;
  state: string;
  updatedAt: string;
}

const REFUND_IN_FLIGHT = new Set(['claimed', 'requested', 'pending', 'processing']);
const REFUND_BAD = new Set(['failed', 'needs_attention']);

/** Refund stuck or failed (T15). */
export function detectRefundProblems(rows: readonly ObligationRow[], now: Date, stuckHours = 72): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (REFUND_BAD.has(r.state)) {
      out.push({ checkId: 'rental-refund-failed', severity: 'critical', entityType: 'refund_obligation', entityId: r.id, title: `Refund ${r.state.replace('_', ' ')}`, detail: { state: r.state } });
    } else if (REFUND_IN_FLIGHT.has(r.state) && now.getTime() - new Date(r.updatedAt).getTime() > stuckHours * HOUR) {
      out.push({ checkId: 'rental-refund-stuck', severity: 'warn', entityType: 'refund_obligation', entityId: r.id, title: `Refund ${r.state} for more than ${stuckHours}h`, detail: { state: r.state } });
    }
  }
  return out;
}

const PAYOUT_IN_FLIGHT = new Set(['claimed', 'pending', 'received']);
const PAYOUT_BAD = new Set(['failed', 'reversed', 'blocked', 'rejected', 'abandoned', 'needs_attention', 'otp']);

/** Payout stuck or failed. */
export function detectPayoutProblems(rows: readonly ObligationRow[], now: Date, stuckHours = 48): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (PAYOUT_BAD.has(r.state)) {
      out.push({ checkId: 'rental-payout-failed', severity: 'critical', entityType: 'owner_payout', entityId: r.id, title: `Owner payout ${r.state}`, detail: { state: r.state } });
    } else if (PAYOUT_IN_FLIGHT.has(r.state) && now.getTime() - new Date(r.updatedAt).getTime() > stuckHours * HOUR) {
      out.push({ checkId: 'rental-payout-stuck', severity: 'warn', entityType: 'owner_payout', entityId: r.id, title: `Owner payout ${r.state} for more than ${stuckHours}h`, detail: { state: r.state } });
    }
  }
  return out;
}

export interface InboxRow {
  id: string;
  status: string;
  receivedAt: string;
}

/** Unprocessed webhook backlog and dead letters. One finding per check, not per event. */
export function detectInboxProblems(rows: readonly InboxRow[], now: Date, backlogMinutes = 60): Finding[] {
  const out: Finding[] = [];
  const dead = rows.filter((r) => r.status === 'dead');
  const old = rows.filter((r) => ['received', 'failed', 'processing'].includes(r.status) && now.getTime() - new Date(r.receivedAt).getTime() > backlogMinutes * 60_000);
  if (dead.length) out.push({ checkId: 'payment-inbox-dead', severity: 'critical', entityType: 'payment_events', entityId: 'dead', title: `${dead.length} payment event(s) failed repeatedly`, observedValue: dead.length, detail: { ids: dead.slice(0, 20).map((r) => r.id) } });
  if (old.length) out.push({ checkId: 'payment-inbox-backlog', severity: 'warn', entityType: 'payment_events', entityId: 'backlog', title: `${old.length} payment event(s) unprocessed for over ${backlogMinutes} minutes`, observedValue: old.length, detail: { ids: old.slice(0, 20).map((r) => r.id) } });
  return out;
}

export interface StockRow {
  rentalId: string;
  stock: number;
  /** Peak units held on any one day by confirmed-or-later bookings. */
  peakHeld: number;
}

/** Inventory conflict: more units out than exist (should be impossible after 070; a canary). */
export function detectInventoryConflicts(rows: readonly StockRow[]): Finding[] {
  return rows
    .filter((r) => r.peakHeld > r.stock)
    .map((r) => ({ checkId: 'rental-inventory-conflict', severity: 'critical' as const, entityType: 'smart_rental', entityId: r.rentalId, title: 'More units booked than exist', observedValue: r.peakHeld, threshold: r.stock }));
}
