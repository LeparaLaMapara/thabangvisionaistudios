import { createAdminClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/core/pricing/money';
import { refundableRemainder } from '@/lib/core/rental/refunds';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The original charge behind a gear booking and what can still be refunded on
 * it (the charge less refunds already owed or made, T14). The charge is the
 * recorded payment intent (070). For orders placed before 070 it is the
 * succeeded payment lines for the order, and failing that the line's deposit.
 */
export async function chargeOfBooking(
  db: Admin,
  b: { id?: string; checkout_group_id: string | null; payfast_payment_id: string | null; deposit_amount?: number | null },
): Promise<{ totalCents: number; remainderCents: number }> {
  let total = toCents(Number(b.deposit_amount ?? 0));
  if (b.checkout_group_id) {
    const { data: intent, error: intentErr } = await db.from('rental_payment_intents').select('expected_amount_cents, state').eq('checkout_group_id', b.checkout_group_id).maybeSingle();
    if (intentErr) throw new Error(`chargeOfBooking: intent lookup failed: ${intentErr.message}`);
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
  const { data: existing, error: existingErr } = await db.from('refund_obligations').select('amount_cents, state').eq('transaction_reference', b.payfast_payment_id ?? '');
  // A failed lookup is not "nothing refunded yet": stop rather than over-refund.
  if (existingErr) throw new Error(`chargeOfBooking: refund lookup failed: ${existingErr.message}`);
  // Failed refunds count too: the provider can still process them (same rule as the DB cap).
  const already = ((existing ?? []) as { amount_cents: number; state: string }[]).reduce((sum, r) => sum + r.amount_cents, 0);
  return { totalCents: total, remainderCents: refundableRemainder({ chargedCents: total, refundedOrInFlightCents: already }) };
}
