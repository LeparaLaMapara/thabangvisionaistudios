export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/data/events';
import { systemClock } from '@/lib/core/ports';
import { matchProviderRefund, refundObligationKey } from '@/lib/core/rental/refunds';
import { submitPayout, submitRefund } from '@/lib/core/rental/use-cases';
import { paymentPort, payoutPort } from '@/lib/payments/ports';
import { SupabasePayouts, SupabaseRefunds, isMissingPipeline } from '@/lib/rental/repos';
import { evaluatePayout } from '@/lib/rental/workers';
import { drainInbox } from '@/lib/rental/inbox';
import { dispatchOutbox } from '@/lib/rental/notify';
import { runRentalPipeline } from '@/lib/rental/pipeline';

/**
 * Rental operations queues for staff (spec §7.15): refunds, payouts, failed
 * payment events, overdue escalations, money that needs a person, and
 * bookings that need risk approval. Every action re-checks the rules on the
 * server. Hiding a button is not authorisation, so each action also requires
 * an admin session here.
 */

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const db = createAdminClient();

  const probe = await db.from('refund_obligations').select('id', { head: true, count: 'exact' });
  if (probe.error && isMissingPipeline(probe.error)) {
    return NextResponse.json({ pipeline: false, message: 'Migration 070 is not applied on this database yet.' });
  }

  const [refunds, payouts, events, escalations, intents, outbox, approvals, journals] = await Promise.all([
    db.from('refund_obligations').select('id, reason, state, amount_cents, attempts, last_error, booking_ids, user_id, created_at, updated_at').neq('state', 'processed').order('created_at', { ascending: false }).limit(100),
    db.from('owner_payouts').select('id, booking_id, owner_id, state, owner_amount_cents, platform_commission_cents, scheduled_at, hold_reasons, last_error, transfer_reference').neq('state', 'success').order('scheduled_at').limit(100),
    db.from('payment_events').select('id, event_type, provider_reference, processing_status, retry_count, last_error, received_at, outcome').in('processing_status', ['failed', 'dead', 'received', 'processing']).order('received_at').limit(100),
    db.from('rental_escalations').select('id, booking_id, stage, hours_late, created_at, acted_at, outcome').is('acted_at', null).order('created_at').limit(100),
    db.from('rental_payment_intents').select('reference, checkout_group_id, state, expected_amount_cents, mismatch_reason, updated_at').in('state', ['mismatch', 'refund_due']).limit(100),
    db.from('notification_outbox').select('id, kind, channel, status, attempts, last_error, created_at').in('status', ['failed', 'dead']).order('created_at', { ascending: false }).limit(50),
    db.from('equipment_bookings').select('id, user_id, status, start_date, end_date').eq('requires_manual_approval', true).in('status', ['pending', 'confirmed']).limit(100),
    db.from('ledger_journals').select('idempotency_key, kind, booking_group_id, memo, created_at').order('created_at', { ascending: false }).limit(50),
  ]);

  const names = await describe(db, {
    bookingIds: [
      ...((refunds.data ?? []) as { booking_ids: string[] | null }[]).flatMap((r) => r.booking_ids ?? []),
      ...((payouts.data ?? []) as { booking_id: string }[]).map((p) => p.booking_id),
      ...((escalations.data ?? []) as { booking_id: string }[]).map((e) => e.booking_id),
      ...((approvals.data ?? []) as { id: string }[]).map((a) => a.id),
    ],
    orderIds: [
      ...((intents.data ?? []) as { checkout_group_id: string | null }[]).map((i) => i.checkout_group_id ?? ''),
      ...((journals.data ?? []) as { booking_group_id: string | null }[]).map((j) => j.booking_group_id ?? ''),
    ],
    peopleIds: ((payouts.data ?? []) as { owner_id: string }[]).map((p) => p.owner_id),
  });

  // A card refund the provider refused is paid by bank transfer instead: show
  // whether the renter has added a bank account yet (they are asked to, by
  // email, push and SMS: refund_failed). Last four digits only.
  type RefundOut = { state: string; user_id: string | null } & Record<string, unknown>;
  const refundRows = (refunds.data ?? []) as RefundOut[];
  const stuck = [...new Set(refundRows.filter((r) => ['failed', 'needs_attention'].includes(r.state) && r.user_id).map((r) => r.user_id as string))];
  const banks = new Map<string, Record<string, unknown>>();
  if (stuck.length > 0) {
    const { data: rows } = await db
      .from('banking_details')
      .select('user_id, bank_name, account_last4, account_holder, is_verified, paystack_recipient_code, updated_at')
      .in('user_id', stuck);
    for (const b of (rows ?? []) as { user_id: string }[]) banks.set(b.user_id, b);
  }
  const refundsOut = refundRows.map((r) => {
    if (!['failed', 'needs_attention'].includes(r.state) || !r.user_id) return r;
    const b = banks.get(r.user_id) as
      | { bank_name: string | null; account_last4: string | null; account_holder: string | null; is_verified: boolean | null; paystack_recipient_code: string | null; updated_at: string | null }
      | undefined;
    return {
      ...r,
      bank: b
        ? {
            bank_name: b.bank_name,
            account_last4: b.account_last4,
            account_holder: b.account_holder,
            validated: b.is_verified === true,
            recipient_code: b.paystack_recipient_code,
            updated_at: b.updated_at,
          }
        : null,
    };
  });

  return NextResponse.json({
    pipeline: true,
    names,
    refunds: refundsOut,
    payouts: payouts.data ?? [],
    events: events.data ?? [],
    escalations: escalations.data ?? [],
    unallocated: intents.data ?? [],
    outbox: outbox.data ?? [],
    risk_approvals: approvals.data ?? [],
    recent_journals: journals.data ?? [],
  });
}

/** Names for the ids the queues hold, so the page shows people and gear, not ids. */
interface Names {
  bookings: Record<string, { gear: string; renter: string; phone: string | null }>;
  orders: Record<string, { gear: string; renter: string }>;
  people: Record<string, { name: string; phone: string | null }>;
}

async function describe(
  db: ReturnType<typeof createAdminClient>,
  ids: { bookingIds: string[]; orderIds: string[]; peopleIds: string[] },
): Promise<Names> {
  const out: Names = { bookings: {}, orders: {}, people: {} };
  const bookingIds = [...new Set(ids.bookingIds.filter(Boolean))].slice(0, 300);
  const orderIds = [...new Set(ids.orderIds.filter(Boolean))].slice(0, 300);
  type Line = { id: string; user_id: string | null; rental_id: string | null; checkout_group_id: string | null };
  const lines: Line[] = [];
  if (bookingIds.length) {
    const { data } = await db.from('equipment_bookings').select('id, user_id, rental_id, checkout_group_id').in('id', bookingIds);
    lines.push(...((data ?? []) as Line[]));
  }
  if (orderIds.length) {
    const { data } = await db.from('equipment_bookings').select('id, user_id, rental_id, checkout_group_id').in('checkout_group_id', orderIds);
    lines.push(...((data ?? []) as Line[]));
  }
  const rentalIds = [...new Set(lines.map((l) => l.rental_id).filter((x): x is string => Boolean(x)))];
  const personIds = [...new Set([...lines.map((l) => l.user_id ?? ''), ...ids.peopleIds].filter(Boolean))];
  const [rentals, people] = await Promise.all([
    rentalIds.length ? db.from('smart_rentals').select('id, title').in('id', rentalIds) : Promise.resolve({ data: [] }),
    personIds.length
      ? db.from('profiles').select('id, display_name, first_name, last_name, phone').in('id', personIds)
      : Promise.resolve({ data: [] }),
  ]);
  const title = new Map(((rentals.data ?? []) as { id: string; title: string }[]).map((r) => [r.id, r.title]));
  for (const p of (people.data ?? []) as { id: string; display_name: string | null; first_name: string | null; last_name: string | null; phone: string | null }[]) {
    out.people[p.id] = {
      name: p.display_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Unnamed person',
      phone: p.phone,
    };
  }
  for (const l of lines) {
    const person = out.people[l.user_id ?? ''];
    const gear = title.get(l.rental_id ?? '') ?? 'Gear';
    out.bookings[l.id] = { gear, renter: person?.name ?? 'A customer', phone: person?.phone ?? null };
    if (l.checkout_group_id) {
      const prev = out.orders[l.checkout_group_id];
      out.orders[l.checkout_group_id] = prev
        ? { ...prev, gear: prev.gear.includes(gear) ? prev.gear : `${prev.gear}, ${gear}` }
        : { gear, renter: person?.name ?? 'A customer' };
    }
  }
  return out;
}

type Action =
  | { action: 'retry_refund'; id: string }
  | { action: 'approve_payout'; id: string }
  | { action: 'hold_payout'; id: string; reason: string }
  | { action: 'requeue_event'; id: string }
  | { action: 'ack_escalation'; id: string; outcome: string; notes?: string }
  | { action: 'refund_unallocated'; reference: string; note: string }
  | { action: 'run_pipeline' };

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as Action | null;
  if (!body || typeof body !== 'object' || !('action' in body)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  const db = createAdminClient();
  const audit = (meta: Record<string, unknown>) =>
    logEvent({ eventType: `rental_ops_${body.action}`, eventCategory: 'admin', userId: auth.user.id, metadata: meta });

  switch (body.action) {
    case 'retry_refund': {
      // A person decided to try again. Reconcile first if the last attempt was uncertain (handled by submitRefund).
      const refunds = new SupabaseRefunds(db);
      const r = await refunds.get(body.id);
      if (!r) return NextResponse.json({ error: 'Refund not found.' }, { status: 404 });
      if (r.state === 'failed' || r.state === 'needs_attention') {
        // Ask the provider first (T13). A refund the provider already holds
        // (e.g. needs-attention, or a failure later retried on their side) is
        // followed, never sent a second time.
        const known = await paymentPort.listRefunds(r.transactionReference);
        if (!known.ok) return NextResponse.json({ error: 'Could not check with the payment provider. Nothing was sent; try again later.' }, { status: 503 });
        const taken = new Set<string>();
        for (const c of known.value) {
          const owner = c.providerRefundId ? await refunds.findByProvider({ providerRefundId: c.providerRefundId }) : null;
          if (owner && owner.id !== r.id) taken.add(c.providerRefundId);
        }
        const m = matchProviderRefund(r, known.value, taken);
        if (m.kind === 'ambiguous') {
          return NextResponse.json({ error: 'Several refunds at the provider could be this one. Check the provider dashboard; nothing was sent.', code: 'AMBIGUOUS_AT_PROVIDER' }, { status: 409 });
        }
        // Any refund the provider still lists for this obligation, failed ones
        // included, blocks a resend: a failed provider refund can still be
        // processed later, and a second one would refund the customer twice.
        // Only an obligation the provider has no record of is sent again.
        const existing = m.kind === 'match' ? m.refund : null;
        if (existing) {
          audit({ refundId: r.id, outcome: 'already_at_provider', providerStatus: existing.status });
          return NextResponse.json(
            {
              error:
                existing.status === 'failed'
                  ? 'The provider still lists this refund as failed. Resolve it with the provider first (it can still be completed on their side); it was not sent again.'
                  : `The provider already has this refund (status: ${existing.status}). Resolve it in the provider dashboard; it was not sent again.`,
              code: 'ALREADY_AT_PROVIDER',
            },
            { status: 409 },
          );
        }
        const reopened = await refunds.transition(r.id, [r.state], 'eligible', { lastError: `reopened by ${auth.user.id}` }, null, []);
        if (!reopened) return NextResponse.json({ error: 'The refund changed; reload.' }, { status: 409 });
      }
      const outcome = await submitRefund(r.id, { refunds, payments: paymentPort, clock: systemClock });
      audit({ refundId: r.id, outcome });
      await dispatchOutbox(10).catch(() => undefined);
      return NextResponse.json({ ok: true, outcome });
    }

    case 'approve_payout': {
      const payouts = new SupabasePayouts(db);
      const p = await payouts.get(body.id);
      if (!p) return NextResponse.json({ error: 'Payout not found.' }, { status: 404 });
      if (p.state !== 'scheduled' && p.state !== 'held') return NextResponse.json({ error: `This payout is ${p.state}.` }, { status: 409 });
      // Approval never bypasses the conditions (spec §7.8).
      const decision = await evaluatePayout(db, { booking_id: p.bookingId, owner_id: p.ownerId }, new Date());
      if (!decision.eligible) {
        await payouts.transition(p.id, [p.state], 'held', { holdReasons: decision.reasons }, null, []);
        return NextResponse.json({ error: 'Not eligible yet.', reasons: decision.reasons }, { status: 409 });
      }
      if (!decision.recipientCode) return NextResponse.json({ error: 'The owner has no validated payout account.' }, { status: 409 });
      const approved = await payouts.transition(p.id, [p.state], 'approved', { recipientCode: decision.recipientCode, approvedBy: auth.user.id, holdReasons: [] }, null, []);
      if (!approved) return NextResponse.json({ error: 'The payout changed; reload.' }, { status: 409 });
      const outcome = await submitPayout(p.id, { payouts, transfers: payoutPort, clock: systemClock });
      audit({ payoutId: p.id, outcome });
      await dispatchOutbox(10).catch(() => undefined);
      return NextResponse.json({ ok: true, outcome });
    }

    case 'hold_payout': {
      const reason = (body.reason ?? '').trim();
      if (reason.length < 3) return NextResponse.json({ error: 'Say why the payout is held.' }, { status: 400 });
      const payouts = new SupabasePayouts(db);
      const p = await payouts.get(body.id);
      if (!p) return NextResponse.json({ error: 'Payout not found.' }, { status: 404 });
      const held = await payouts.transition(p.id, ['scheduled', 'approved'], 'held', { holdReasons: [`staff: ${reason.slice(0, 200)}`] }, null, []);
      audit({ payoutId: p.id, held });
      return held ? NextResponse.json({ ok: true }) : NextResponse.json({ error: `A ${p.state} payout cannot be held here.` }, { status: 409 });
    }

    case 'requeue_event': {
      const { data, error } = await db
        .from('payment_events')
        .update({ processing_status: 'received', next_attempt_at: new Date().toISOString(), retry_count: 0, last_error: null })
        .eq('id', body.id)
        .in('processing_status', ['failed', 'dead'])
        .select('id');
      if (error) return NextResponse.json({ error: 'Could not requeue.' }, { status: 500 });
      if (!data?.length) return NextResponse.json({ error: 'Only failed or dead events can be requeued.' }, { status: 409 });
      const result = await drainInbox(5);
      audit({ eventId: body.id, result });
      return NextResponse.json({ ok: true, result });
    }

    case 'ack_escalation': {
      const outcome = (body.outcome ?? '').trim();
      if (outcome.length < 3) return NextResponse.json({ error: 'Record what was done.' }, { status: 400 });
      const { data, error } = await db
        .from('rental_escalations')
        .update({ acted_by: auth.user.id, acted_at: new Date().toISOString(), outcome: outcome.slice(0, 300), notes: body.notes?.trim().slice(0, 2000) ?? null })
        .eq('id', body.id)
        .is('acted_at', null)
        .select('id');
      if (error) return NextResponse.json({ error: 'Could not record.' }, { status: 500 });
      audit({ escalationId: body.id });
      return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Already recorded.' }, { status: 409 });
    }

    case 'refund_unallocated': {
      // Money that arrived but could not be applied (e.g. wrong amount). A person
      // has checked it; the full receipt goes back as one obligation.
      const note = (body.note ?? '').trim();
      if (note.length < 3) return NextResponse.json({ error: 'Say what you checked.' }, { status: 400 });
      const { data: intent } = await db.from('rental_payment_intents').select('checkout_group_id, user_id, state').eq('reference', body.reference).maybeSingle();
      if (!intent || !['mismatch', 'refund_due'].includes((intent as { state: string }).state)) {
        return NextResponse.json({ error: 'No unallocated payment for this reference.' }, { status: 404 });
      }
      const i = intent as { checkout_group_id: string; user_id: string };
      const { data: journals, error: journalsErr } = await db
        .from('ledger_journals')
        .select('idempotency_key, ledger_lines(account, debit_cents)')
        .eq('booking_group_id', i.checkout_group_id)
        .like('idempotency_key', 'unallocated:%');
      if (journalsErr) return NextResponse.json({ error: 'Could not load the receipts just now. Nothing was created; try again.' }, { status: 503 });
      let created = 0;
      for (const j of (journals ?? []) as { idempotency_key: string; ledger_lines: { account: string; debit_cents: number }[] }[]) {
        const tx = j.idempotency_key.slice('unallocated:'.length);
        const amount = Number(j.ledger_lines.find((l) => l.account === 'cash_at_provider')?.debit_cents ?? 0);
        if (!tx || amount <= 0) continue;
        const { error } = await db.from('refund_obligations').upsert({
          obligation_key: refundObligationKey('overpayment', tx),
          reason: 'overpayment',
          amount_cents: amount,
          charged_cents: amount,
          transaction_reference: tx,
          user_id: i.user_id,
          booking_group_id: i.checkout_group_id,
          from_unallocated: true,
          evidence: { note: note.slice(0, 500), by: auth.user.id },
          created_by: auth.user.id,
        }, { onConflict: 'obligation_key', ignoreDuplicates: true });
        if (!error) created += 1;
      }
      audit({ reference: body.reference, created });
      await runRentalPipeline().catch(() => undefined);
      return NextResponse.json({ ok: true, created });
    }

    case 'run_pipeline': {
      const result = await runRentalPipeline();
      audit({ ok: result.ok, errors: Object.keys(result.errors) });
      return NextResponse.json(result);
    }

    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
}
