import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { allocateCents, toCents } from '@/lib/core/pricing/money';
import { splitHire } from '@/lib/core/pricing/rental';
import { isMissingPipeline } from './repos';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Reserving a gear order. The database function reserve_rental_order (070)
 * locks the listings, re-checks stock and inserts every line plus the
 * payment intent in one transaction. All lines or none (T07). The read-only
 * availability check before it is only for friendly messages.
 */

/**
 * A stable order id per customer + idempotency key. A repeated checkout
 * request (double click, retry after a timeout) maps to the same order, which
 * the database refuses to create twice (T06).
 */
export function checkoutGroupIdFor(userId: string, idempotencyKey: string | null): string {
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) return crypto.randomUUID();
  const h = crypto.createHash('sha256').update(`checkout:${userId}:${idempotencyKey}`).digest('hex');
  // Format as an RFC 4122 version-5-style UUID.
  const v = (parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v.toString(16).padStart(2, '0')}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export interface LineInput {
  rentalId: string;
  quantity: number;
  /** Hire before any order discount, in rands, as the cart priced it. */
  subtotalRands: number;
  depositRands: number;
  unitReplacementValueRands: number;
  ownerType: string | null;
  ownerId: string | null;
}

export interface LineSnapshot {
  hire_cents: number;
  deposit_cents: number;
  owner_share_cents: number | null;
  platform_share_cents: number | null;
  unit_replacement_value_cents: number;
  ownership: 'studio' | 'community';
  owner_id: string | null;
}

/**
 * Money snapshot for each line, in cents. The order discount is spread over the
 * lines in proportion to their hire, so the line hires add up to the order hire
 * exactly. For community gear the hire is split owner/platform. The deposit is
 * never part of that split.
 */
export function snapshotLines(lines: readonly LineInput[], discountRands: number): LineSnapshot[] {
  const subtotals = lines.map((l) => toCents(l.subtotalRands));
  const totalHire = subtotals.reduce((a, b) => a + b, 0);
  const netHire = totalHire - toCents(discountRands);
  const hires = totalHire > 0 ? allocateCents(netHire, subtotals) : subtotals.map(() => 0);
  return lines.map((l, i) => {
    const community = l.ownerType === 'community' && Boolean(l.ownerId);
    const split = community ? splitHire(hires[i]) : null;
    return {
      hire_cents: hires[i],
      deposit_cents: toCents(l.depositRands),
      owner_share_cents: split ? split.ownerShareCents : null,
      platform_share_cents: split ? split.platformShareCents : null,
      unit_replacement_value_cents: toCents(l.unitReplacementValueRands),
      ownership: community ? 'community' : 'studio',
      owner_id: community ? l.ownerId : null,
    };
  });
}

export interface IntentInput {
  reference: string;
  provider: string;
  expectedAmountCents: number;
  depositCents: number;
  deliveryCents: number;
}

export type ReserveResult =
  | { ok: true; bookingIds: string[]; holdExpiresAt: string }
  | { ok: false; code: 'insufficient_stock' | 'listing_unavailable'; rentalId: string | null }
  | { ok: false; code: 'duplicate_order' }
  | { ok: false; code: 'missing_pipeline' }
  | { ok: false; code: 'error'; message: string };

export async function reserveOrder(
  db: Admin,
  rows: Record<string, unknown>[],
  intent: IntentInput | null,
  holdMinutes: number,
): Promise<ReserveResult> {
  let p_intent: Record<string, unknown> | null = null;
  if (intent) {
    const hire = intent.expectedAmountCents - intent.depositCents - intent.deliveryCents;
    if (hire < 0) return { ok: false, code: 'error', message: 'amount due is less than deposit plus delivery' };
    p_intent = {
      reference: intent.reference,
      provider: intent.provider,
      expected_amount_cents: intent.expectedAmountCents,
      hire_cents: hire,
      deposit_cents: intent.depositCents,
      delivery_cents: intent.deliveryCents,
    };
  }
  const { data, error } = await db.rpc('reserve_rental_order', { p_rows: rows, p_intent, p_hold_minutes: holdMinutes });
  if (error) {
    if (isMissingPipeline(error)) return { ok: false, code: 'missing_pipeline' };
    const msg = error.message ?? '';
    const id = msg.match(/:([0-9a-f-]{36})/)?.[1] ?? null;
    if (error.code === 'P0001' || msg.startsWith('insufficient_stock')) return { ok: false, code: 'insufficient_stock', rentalId: id };
    if (error.code === 'P0002' || msg.startsWith('listing_unavailable')) return { ok: false, code: 'listing_unavailable', rentalId: id };
    if (error.code === '23505') return { ok: false, code: 'duplicate_order' };
    return { ok: false, code: 'error', message: msg };
  }
  const result = data as { booking_ids: string[]; hold_expires_at: string };
  return { ok: true, bookingIds: result.booking_ids, holdExpiresAt: result.hold_expires_at };
}

/**
 * Undo a reservation whose payment page could not be created (nothing was
 * paid). Its delivery quotes are unlinked (still unpaid), so they never stay
 * tied to an order that no longer exists and the next checkout can use them.
 */
export async function releaseUnpaidReservation(db: Admin, checkoutGroupId: string): Promise<void> {
  await db.from('equipment_bookings').delete().eq('checkout_group_id', checkoutGroupId).eq('status', 'pending').is('payfast_payment_id', null);
  const { error } = await db.from('rental_payment_intents').delete().eq('checkout_group_id', checkoutGroupId).eq('state', 'initiated');
  if (error && !isMissingPipeline(error)) console.error('[reserve] could not remove intent:', error.message);
  const { error: quoteErr } = await db
    .from('delivery_quotes')
    .update({ booking_group_id: null, updated_at: new Date().toISOString() })
    .eq('booking_group_id', checkoutGroupId)
    .in('status', ['active', 'expired']);
  if (quoteErr && !isMissingPipeline(quoteErr)) console.error('[reserve] could not unlink delivery quotes:', quoteErr.message);
}
