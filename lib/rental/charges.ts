import { createAdminClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/core/pricing/money';
import { refundableRemainder } from '@/lib/core/rental/refunds';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The original charge behind a gear booking and what can still be refunded on
 * it (the charge less refunds already owed or made, T14). The charge is the
 * recorded payment intent (070). For orders placed before 070 it is the
 * succeeded payment lines for the order, and failing that the line's deposit.
 *
 * "Already owed or made" counts EVERY refund obligation on the order's charge
 * (review fix round 2, finding 2), whatever its reason and whichever
 * reference it was filed under: hire, deposit and staff refunds carry the
 * provider's transaction id (`payfast_payment_id`), while delivery-fee refunds
 * (076) carry the payment intent's reference. Both references of the order's
 * intent, the line's own reference and any obligation filed against the order
 * (`booking_group_id`, except money that arrived apart from the order's
 * charge, `from_unallocated`) are summed once each.
 */
export async function chargeOfBooking(
  db: Admin,
  b: { id?: string; checkout_group_id: string | null; payfast_payment_id: string | null; deposit_amount?: number | null },
): Promise<{ totalCents: number; remainderCents: number }> {
  let total = toCents(Number(b.deposit_amount ?? 0));
  const refs = new Set<string>(b.payfast_payment_id ? [b.payfast_payment_id] : []);
  if (b.checkout_group_id) {
    const { data: intent, error: intentErr } = await db
      .from('rental_payment_intents')
      .select('expected_amount_cents, state, reference, provider_transaction_id')
      .eq('checkout_group_id', b.checkout_group_id)
      .maybeSingle();
    if (intentErr) throw new Error(`chargeOfBooking: intent lookup failed: ${intentErr.message}`);
    const row = intent as { reference?: string | null; provider_transaction_id?: string | null } | null;
    for (const r of [row?.reference, row?.provider_transaction_id]) if (r) refs.add(r);
    if (intent && (intent as { state: string }).state === 'paid') {
      total = (intent as { expected_amount_cents: number }).expected_amount_cents;
    } else {
      const { data: lines, error: linesErr } = await db.from('equipment_bookings').select('id').eq('checkout_group_id', b.checkout_group_id);
      if (linesErr) throw new Error(`chargeOfBooking: order lookup failed: ${linesErr.message}`);
      const ids = ((lines ?? []) as { id: string }[]).map((l) => l.id);
      const { data: paid, error: paidErr } = ids.length ? await db.from('booking_payments').select('amount').in('booking_id', ids).eq('status', 'succeeded') : { data: [], error: null };
      if (paidErr) throw new Error(`chargeOfBooking: payment lookup failed: ${paidErr.message}`);
      const sum = ((paid ?? []) as { amount: number }[]).reduce((acc, p) => acc + toCents(Number(p.amount ?? 0)), 0);
      if (sum > 0) total = sum;
    }
  } else if (b.id) {
    // A single booking from before cart checkout: its own recorded payments.
    const { data: paid, error: paidErr } = await db.from('booking_payments').select('amount').eq('booking_id', b.id).eq('status', 'succeeded');
    if (paidErr) throw new Error(`chargeOfBooking: payment lookup failed: ${paidErr.message}`);
    const sum = ((paid ?? []) as { amount: number }[]).reduce((acc, p) => acc + toCents(Number(p.amount ?? 0)), 0);
    if (sum > 0) total = sum;
  }
  type Ob = { id: string; amount_cents: number; state: string };
  const [byRef, byOrder] = await Promise.all([
    refs.size > 0 ? db.from('refund_obligations').select('id, amount_cents, state').in('transaction_reference', [...refs]) : Promise.resolve({ data: [] as Ob[], error: null }),
    b.checkout_group_id
      ? db.from('refund_obligations').select('id, amount_cents, state').eq('booking_group_id', b.checkout_group_id).eq('from_unallocated', false)
      : Promise.resolve({ data: [] as Ob[], error: null }),
  ]);
  // A failed lookup is not "nothing refunded yet": stop rather than over-refund.
  for (const r of [byRef, byOrder]) if (r.error) throw new Error(`chargeOfBooking: refund lookup failed: ${r.error.message}`);
  // Failed refunds count too: the provider can still process them (same rule as the DB cap).
  // Each obligation once, even when both lookups return it (an id-less row is never merged away).
  const seen = new Map<string, number>();
  [...((byRef.data ?? []) as Ob[]), ...((byOrder.data ?? []) as Ob[])].forEach((r, i) => seen.set(r.id ? String(r.id) : `row-${i}`, Number(r.amount_cents)));
  const already = [...seen.values()].reduce((sum, c) => sum + c, 0);
  return { totalCents: total, remainderCents: refundableRemainder({ chargedCents: total, refundedOrInFlightCents: already }) };
}
