import { DELIVERY_CHECKOUT, DELIVERY_POLICY } from '@/lib/constants';
import { toCents } from '@/lib/core/pricing/money';
import { itemValue } from '@/lib/rental/protection';
import { createAdminClient } from '@/lib/supabase/server';
import { isMissingPipeline } from '@/lib/rental/repos';
import type { DeliveryWindow } from '@/lib/core/delivery/port';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import type { DeliveryDeps } from '@/lib/core/delivery/repository';
import type { ShipmentLeg } from '@/lib/core/delivery/state';
import { SupabaseDeliveryRepository } from './repos';
import { priceDeliveryForCheckout, quoteDelivery, type DeliveryCaller, type DeliveryLineInput } from '@/lib/core/delivery/use-cases';

/**
 * The customer side of delivery at checkout (spec Phase 4 §4.7, §4.17).
 *
 *  - delivery lines are built from the cart on the server (never from the browser);
 *  - every price is a stored, expiring quote from quoteDelivery;
 *  - the checkout charges what priceDeliveryForCheckout says, and nothing else;
 *  - an expired quote is re-quoted here; if the total moved, the customer must
 *    approve the new total before anything is reserved or charged (D07, D08).
 */

export interface CartLineForDelivery {
  rentalId: string;
  quantity: number;
  unitReplacementValueCents: number;
  startDate: string;
  endDate: string;
}

export function deliveryLines(lines: readonly CartLineForDelivery[]): DeliveryLineInput[] {
  return lines.map((l) => ({
    rentalId: l.rentalId,
    unitReplacementValueCents: l.unitReplacementValueCents,
    quantity: Math.max(1, l.quantity),
    startDate: l.startDate.slice(0, 10),
    endDate: l.endDate.slice(0, 10),
    // Generic, never the brand or value (spec §4.10).
    driverLabel: DELIVERY_POLICY.driverLabel,
    weightGrams: null,
    containsLithium: DELIVERY_POLICY.assumeLithiumBatteries,
  }));
}

/**
 * The cart as delivery lines, read on the server. Null when an item has no
 * dates yet (a quote needs the hire days).
 */
export function cartLinesForDelivery(
  items: readonly { rental_id: string; quantity: number; start_date: string | null; end_date: string | null; rental: { replacement_value?: number | null; deposit_amount?: number | null } }[],
  shared: { start: string | null; end: string | null } = { start: null, end: null },
): CartLineForDelivery[] | null {
  const out: CartLineForDelivery[] = [];
  for (const i of items) {
    const start = i.start_date ?? shared.start;
    const end = i.end_date ?? shared.end;
    if (!start || !end) return null;
    out.push({ rentalId: i.rental_id, quantity: i.quantity, unitReplacementValueCents: toCents(itemValue(i.rental)), startDate: start, endDate: end });
  }
  return out;
}

/** The day a leg runs: the first hire day out, the last hire day back. */
export function legDate(lines: readonly { startDate: string; endDate: string }[], leg: ShipmentLeg): string | null {
  if (lines.length === 0) return null;
  const days = lines.map((l) => (leg === 'outbound' ? l.startDate : l.endDate).slice(0, 10)).sort();
  return leg === 'outbound' ? days[0] : days[days.length - 1];
}

export type WindowId = (typeof DELIVERY_CHECKOUT.windows)[number]['id'];

export function isWindowId(v: unknown): v is WindowId {
  return DELIVERY_CHECKOUT.windows.some((w) => w.id === v);
}

/** A scheduled window (SAST) on a given day. Null for an unknown slot or a malformed date. */
export function windowFor(dateYmd: string, slot: unknown): DeliveryWindow | null {
  const w = DELIVERY_CHECKOUT.windows.find((x) => x.id === slot);
  if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const at = (hm: string): string | null => {
    const d = new Date(`${dateYmd}T${hm}:00${DELIVERY_CHECKOUT.utcOffset}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const start = at(w.start);
  const end = at(w.end);
  return start && end ? { start, end } : null;
}

/** The label of a stored window ("08:00 to 12:00"), for showing it back. */
export function windowLabel(win: DeliveryWindow): string | null {
  if (!win.start) return null;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(DELIVERY_CHECKOUT.utcOffset);
  const offsetMs = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
  const sast = new Date(new Date(win.start).getTime() + offsetMs);
  const hm = `${String(sast.getUTCHours()).padStart(2, '0')}:${String(sast.getUTCMinutes()).padStart(2, '0')}`;
  return DELIVERY_CHECKOUT.windows.find((w) => w.start === hm)?.label ?? null;
}

/** What the browser may see of a quote: the price, the leg and when it expires. No addresses, no provider cost. */
export interface PublicQuote {
  id: string;
  leg: ShipmentLeg;
  provider_kind: 'courier' | 'own_fleet';
  customer_fee_cents: number;
  expires_at: string;
  window_start: string | null;
  window_end: string | null;
  window_label: string | null;
}

export function publicQuote(q: CustomerDeliveryQuote): PublicQuote {
  return {
    id: q.id,
    leg: q.leg,
    provider_kind: q.providerKind,
    customer_fee_cents: q.customerFeeCents,
    expires_at: q.expiresAt,
    window_start: q.window.start,
    window_end: q.window.end,
    window_label: windowLabel(q.window),
  };
}

// ── Linking quotes to the order ─────────────────────────────────────────────

/** Where an order's delivery quotes are found after payment (delivery_quotes.booking_group_id). */
export interface QuoteLinkStore {
  /** Tie an active, unlinked quote to the order. False if it is used elsewhere or no longer active. */
  linkToGroup(quoteId: string, bookingGroupId: string): Promise<boolean>;
  /** Every quote tied to the order (any status). Empty when migration 076 is not applied. */
  quotesForGroup(bookingGroupId: string): Promise<CustomerDeliveryQuote[]>;
  /** Migration 076 is applied (the delivery tables exist). */
  available(): Promise<boolean>;
}

type Admin = ReturnType<typeof createAdminClient>;

export class SupabaseQuoteLinks implements QuoteLinkStore {
  constructor(private db: Admin = createAdminClient()) {}

  async linkToGroup(quoteId: string, bookingGroupId: string): Promise<boolean> {
    // Compare-and-set: only an active quote that no other order has claimed.
    const { data, error } = await this.db
      .from('delivery_quotes')
      .update({ booking_group_id: bookingGroupId, updated_at: new Date().toISOString() })
      .eq('id', quoteId)
      .eq('status', 'active')
      .or(`booking_group_id.is.null,booking_group_id.eq.${bookingGroupId}`)
      .select('id');
    if (error) throw new Error(`link delivery quote failed: ${error.message}`);
    return (data ?? []).length === 1;
  }

  async quotesForGroup(bookingGroupId: string): Promise<CustomerDeliveryQuote[]> {
    const { data, error } = await this.db.from('delivery_quotes').select('id').eq('booking_group_id', bookingGroupId).order('created_at');
    if (error) {
      if (isMissingPipeline(error)) return [];
      throw new Error(`delivery quotes for order failed: ${error.message}`);
    }
    const repo = new SupabaseDeliveryRepository(this.db);
    const out: CustomerDeliveryQuote[] = [];
    for (const r of (data ?? []) as { id: string }[]) {
      const q = await repo.getQuote(r.id);
      if (q) out.push(q);
    }
    return out;
  }

  async available(): Promise<boolean> {
    const { error } = await this.db.from('delivery_quotes').select('id', { head: true, count: 'exact' }).limit(1);
    if (!error) return true;
    if (isMissingPipeline(error)) return false;
    throw new Error(`delivery tables check failed: ${error.message}`);
  }
}

// ── Quote for the cart ──────────────────────────────────────────────────────

export interface LegRequest {
  leg: ShipmentLeg;
  window: DeliveryWindow;
}

export type CartQuoteResult =
  | { ok: true; quotes: CustomerDeliveryQuote[] }
  | { ok: false; collectionOnly: true; code: string; message: string };

/**
 * Quote each requested leg between our site and the renter's verified
 * address. One option per leg (the best that passed every gate). An
 * ineligible renter gets collection only, with the reason.
 */
export async function quoteCartDelivery(
  input: { caller: DeliveryCaller; renterId: string; renterAddressId: string; siteAddressId: string; lines: readonly DeliveryLineInput[]; legs: readonly LegRequest[]; bookingGroupId?: string | null },
  deps: DeliveryDeps,
): Promise<CartQuoteResult> {
  const quotes: CustomerDeliveryQuote[] = [];
  for (const l of input.legs) {
    const out = l.leg === 'outbound';
    const r = await quoteDelivery(
      {
        caller: input.caller,
        renterId: input.renterId,
        bookingGroupId: input.bookingGroupId ?? null,
        leg: l.leg,
        originAddressId: out ? input.siteAddressId : input.renterAddressId,
        destinationAddressId: out ? input.renterAddressId : input.siteAddressId,
        lines: input.lines,
        window: l.window,
      },
      deps,
    );
    if (!r.ok) return { ok: false, collectionOnly: true, code: r.code, message: r.message };
    quotes.push(r.quotes[0]);
  }
  return { ok: true, quotes };
}

// ── Price at checkout ───────────────────────────────────────────────────────

export type CheckoutDeliveryPrice =
  | { ok: true; amountCents: number; quotes: CustomerDeliveryQuote[]; requoted: boolean }
  | {
      ok: false;
      status: 400 | 409;
      code: 'DELIVERY_QUOTE_INVALID' | 'DELIVERY_REQUOTE' | 'DELIVERY_PRICE_CHANGED' | 'DELIVERY_UNAVAILABLE';
      message: string;
      /** The current delivery total the customer must approve (409 only). */
      amountCents?: number;
      quotes?: CustomerDeliveryQuote[];
    };

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

const sum = (qs: readonly CustomerDeliveryQuote[]): number => qs.reduce((s, q) => s + q.customerFeeCents, 0);

/**
 * What this checkout may charge for delivery, from the stored quotes only.
 * `approvedCents` is the delivery total the customer saw and accepted; it is
 * compared, never charged. An expired, superseded or out-of-date quote (the
 * cart changed) is re-quoted for the same addresses and window: the same total
 * goes ahead, a different one comes back for approval.
 */
export async function priceCheckoutDelivery(
  input: { renterId: string; quoteIds: readonly string[]; approvedCents: number | null; lines: readonly DeliveryLineInput[]; bookingGroupId?: string | null },
  deps: DeliveryDeps,
): Promise<CheckoutDeliveryPrice> {
  const invalid = (message: string): CheckoutDeliveryPrice => ({ ok: false, status: 400, code: 'DELIVERY_QUOTE_INVALID', message });
  if (input.quoteIds.length === 0) return invalid('Get a delivery quote first.');
  const quotes = await Promise.all(input.quoteIds.map((id) => deps.repo.getQuote(id)));
  if (quotes.some((q) => !q || q.renterId !== input.renterId)) return invalid('That delivery quote is not valid. Please get a new quote.');
  const qs = quotes as CustomerDeliveryQuote[];
  if (!qs.some((q) => q.leg === 'outbound')) return invalid('Choose a delivery option first.');
  if (new Set(qs.map((q) => q.leg)).size !== qs.length) return invalid('Choose one delivery option per trip.');

  const cartIds = input.lines.map((l) => l.rentalId);
  // A quote is stale when the cart changed, or another order already holds it.
  const stale = qs.some((q) => !sameSet(q.rentalIds, cartIds) || (q.bookingGroupId !== null && q.bookingGroupId !== (input.bookingGroupId ?? null)));

  if (!stale) {
    const check = await priceDeliveryForCheckout({ renterId: input.renterId, quoteIds: qs.map((q) => q.id), browserAmountCents: input.approvedCents }, deps);
    if (check.ok) return { ok: true, amountCents: check.amountCents, quotes: qs, requoted: false };
    if (check.code === 'price_mismatch') {
      return { ok: false, status: 409, code: 'DELIVERY_PRICE_CHANGED', message: check.message, amountCents: sum(qs), quotes: qs };
    }
    if (check.code !== 'quote_expired' && check.code !== 'quote_not_active') return invalid(check.message);
  }

  // Re-quote every leg for the same addresses and window (D07).
  const fresh: CustomerDeliveryQuote[] = [];
  for (const old of qs) {
    const r = await quoteDelivery(
      {
        caller: { kind: 'renter', userId: input.renterId },
        renterId: input.renterId,
        bookingGroupId: null,
        leg: old.leg,
        originAddressId: old.originAddressId,
        destinationAddressId: old.destinationAddressId,
        lines: input.lines,
        window: old.window,
      },
      deps,
    );
    if (!r.ok) return { ok: false, status: 409, code: 'DELIVERY_UNAVAILABLE', message: r.message };
    fresh.push(r.quotes.find((q) => q.providerId === old.providerId) ?? r.quotes[0]);
    // The old quote can no longer be charged.
    if (old.status === 'active' && old.bookingGroupId === null) await deps.repo.setQuoteStatus(old.id, ['active'], 'superseded');
  }
  const total = sum(fresh);
  if (input.approvedCents !== null && input.approvedCents === total) {
    return { ok: true, amountCents: total, quotes: fresh, requoted: true };
  }
  const before = input.approvedCents ?? sum(qs);
  return {
    ok: false,
    status: 409,
    code: 'DELIVERY_REQUOTE',
    message:
      before === total
        ? 'Your delivery quote expired, so we checked the price again. Please confirm the delivery to continue.'
        : `Your delivery quote expired and the price is now different. Please confirm the new delivery total to continue.`,
    amountCents: total,
    quotes: fresh,
  };
}
