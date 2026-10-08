import { createAdminClient } from '@/lib/supabase/server';
import type { Finding } from '@/lib/ops/types';
import {
  detectConfirmedWithoutPayment,
  detectInboxProblems,
  detectIntentProblems,
  detectInventoryConflicts,
  detectPayoutProblems,
  detectRefundProblems,
  type StockRow,
} from '@/lib/core/rental/reconcile';
import { reconcileClosedGroup, type Journal, type LedgerAccount } from '@/lib/core/rental/ledger';
import { isMissingPipeline } from './repos';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Gather half of the rental-pipeline invariants. Called by the daily
 * invariant sweep (app/api/cron/invariants), which de-duplicates, notifies and
 * auto-resolves findings. Returns [] while migration 070 is not applied.
 */
export async function gatherRentalPipelineFindings(db: Admin, now: Date): Promise<Finding[]> {
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();

  const intents = await db
    .from('rental_payment_intents')
    .select('reference, checkout_group_id, state, paid_at, updated_at')
    .gte('created_at', since);
  if (intents.error) {
    if (isMissingPipeline(intents.error)) return [];
    throw new Error(`rental intents: ${intents.error.message}`);
  }

  const groupIds = (intents.data ?? []).map((i) => (i as { checkout_group_id: string }).checkout_group_id);
  const lines = groupIds.length
    ? await db.from('equipment_bookings').select('checkout_group_id, status').in('checkout_group_id', groupIds)
    : { data: [], error: null };
  const byGroup = new Map<string, string[]>();
  for (const l of (lines.data ?? []) as { checkout_group_id: string; status: string }[]) {
    byGroup.set(l.checkout_group_id, [...(byGroup.get(l.checkout_group_id) ?? []), l.status]);
  }

  const [confirmed, refunds, payouts, inbox, stockRows] = await Promise.all([
    db.from('equipment_bookings').select('id, status, payment_method, payfast_payment_id').in('status', ['confirmed', 'active', 'overdue', 'return_pending']).gte('created_at', since),
    db.from('refund_obligations').select('id, state, updated_at').neq('state', 'processed'),
    db.from('owner_payouts').select('id, state, updated_at').neq('state', 'success'),
    db.from('payment_events').select('id, processing_status, received_at').in('processing_status', ['received', 'failed', 'processing', 'dead']),
    db.from('equipment_bookings').select('rental_id, start_date, end_date, quantity, status, smart_rentals(quantity)').in('status', ['confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'disputed']),
  ]);

  const findings: Finding[] = [
    ...detectIntentProblems(
      ((intents.data ?? []) as { reference: string; checkout_group_id: string; state: string; paid_at: string | null; updated_at: string }[]).map((i) => ({
        reference: i.reference,
        state: i.state,
        paidAt: i.paid_at,
        updatedAt: i.updated_at,
        lineStatuses: byGroup.get(i.checkout_group_id) ?? [],
      })),
      now,
    ),
    ...detectConfirmedWithoutPayment(
      ((confirmed.data ?? []) as { id: string; status: string; payment_method: string | null; payfast_payment_id: string | null }[]).map((r) => ({
        id: r.id,
        status: r.status,
        paymentMethod: r.payment_method,
        paymentReference: r.payfast_payment_id,
      })),
    ),
    ...detectRefundProblems(((refunds.data ?? []) as { id: string; state: string; updated_at: string }[]).map((r) => ({ id: r.id, state: r.state, updatedAt: r.updated_at })), now),
    ...detectPayoutProblems(((payouts.data ?? []) as { id: string; state: string; updated_at: string }[]).map((r) => ({ id: r.id, state: r.state, updatedAt: r.updated_at })), now),
    ...detectInboxProblems(((inbox.data ?? []) as { id: string; processing_status: string; received_at: string }[]).map((r) => ({ id: r.id, status: r.processing_status, receivedAt: r.received_at })), now),
    ...detectInventoryConflicts(peakHeld(stockRows.data ?? [])),
    ...(await closedGroupLedgerFindings(db, intents.data ?? [], byGroup)),
  ];
  return findings;
}

/** Peak units held on any single day per listing, by sweeping booking start/end dates. */
function peakHeld(rows: unknown[]): StockRow[] {
  const byRental = new Map<string, { stock: number; events: [string, number][] }>();
  for (const raw of rows as { rental_id: string; start_date: string; end_date: string; quantity: number | null; smart_rentals: unknown }[]) {
    const rental = (Array.isArray(raw.smart_rentals) ? raw.smart_rentals[0] : raw.smart_rentals) as { quantity?: number | null } | null;
    const entry = byRental.get(raw.rental_id) ?? { stock: rental?.quantity ?? 1, events: [] };
    const q = raw.quantity ?? 1;
    entry.events.push([raw.start_date, q]);
    // Inclusive end: the unit is free again the day after.
    const after = new Date(`${raw.end_date}T00:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    entry.events.push([after.toISOString().slice(0, 10), -q]);
    byRental.set(raw.rental_id, entry);
  }
  return [...byRental.entries()].map(([rentalId, { stock, events }]) => {
    events.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1));
    let held = 0;
    let peak = 0;
    for (const [, d] of events) {
      held += d;
      peak = Math.max(peak, held);
    }
    return { rentalId, stock, peakHeld: peak };
  });
}

/** Every financially closed order must leave no liability behind (T30). */
async function closedGroupLedgerFindings(db: Admin, intents: unknown[], byGroup: Map<string, string[]>): Promise<Finding[]> {
  const closed = (intents as { checkout_group_id: string; state: string }[])
    .filter((i) => i.state === 'paid')
    .map((i) => i.checkout_group_id)
    .filter((g) => {
      const statuses = byGroup.get(g) ?? [];
      return statuses.length > 0 && statuses.every((s) => s === 'completed' || s === 'cancelled');
    });
  if (closed.length === 0) return [];

  // A closed order is only "financially closed" once its refunds and payouts are done.
  const [{ data: openRefunds }, { data: openPayouts }, { data: journals }] = await Promise.all([
    db.from('refund_obligations').select('booking_group_id').in('booking_group_id', closed).neq('state', 'processed'),
    db.from('owner_payouts').select('booking_group_id').in('booking_group_id', closed).neq('state', 'success'),
    db.from('ledger_journals').select('idempotency_key, kind, booking_group_id, memo, ledger_lines(account, debit_cents, credit_cents)').in('booking_group_id', closed),
  ]);
  const stillOpen = new Set([...(openRefunds ?? []), ...(openPayouts ?? [])].map((r) => (r as { booking_group_id: string }).booking_group_id));

  const byJournalGroup = new Map<string, Journal[]>();
  for (const j of (journals ?? []) as { idempotency_key: string; kind: Journal['kind']; booking_group_id: string; memo: string; ledger_lines: { account: LedgerAccount; debit_cents: number; credit_cents: number }[] }[]) {
    const journal: Journal = {
      idempotencyKey: j.idempotency_key,
      kind: j.kind,
      bookingGroupId: j.booking_group_id,
      memo: j.memo,
      lines: (j.ledger_lines ?? []).map((l) => ({ account: l.account, debitCents: Number(l.debit_cents), creditCents: Number(l.credit_cents) })),
    };
    byJournalGroup.set(j.booking_group_id, [...(byJournalGroup.get(j.booking_group_id) ?? []), journal]);
  }

  const findings: Finding[] = [];
  for (const g of closed) {
    if (stillOpen.has(g)) continue;
    const issues = reconcileClosedGroup({ journals: byJournalGroup.get(g) ?? [] });
    if (issues.length) {
      findings.push({ checkId: 'rental-ledger-unreconciled', severity: 'warn', entityType: 'checkout_group', entityId: g, title: 'Closed order does not reconcile in the ledger', detail: { issues } });
    }
  }
  return findings;
}
