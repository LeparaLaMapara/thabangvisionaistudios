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
import { priceDeliveryForCheckout, quoteDelivery, sameLineSnapshot, type DeliveryCaller, type DeliveryLineInput } from '@/lib/core/delivery/use-cases';

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
  /**
   * The quotes tied to the order that are part of its payment: every status
   * except `superseded` (replaced before payment, never charged). Empty when
   * migration 076 is not applied.
   */
  quotesForGroup(bookingGroupId: string): Promise<CustomerDeliveryQuote[]>;
  /** Migration 076 is applied (the delivery tables exist). */
  available(): Promise<boolean>;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Whether a PostgREST answer means "this table does not exist here". A HEAD
 * request cannot tell: PostgREST answers a missing table with 404 and an
 * empty body, which postgrest-js turns into status 204 with NO error. So the
 * probes below always use GET, which carries the error body (PGRST205 /
 * 42P01), and also treat a bare 404 as missing.
 */
export function isMissingTable(r: { error: { code?: string; message?: string } | null; status?: number }): boolean {
  if (r.error && isMissingPipeline(r.error)) return true;
  return r.status === 404;
}

/** Probe a table with a real GET (never HEAD). True when it exists. Throws on any other failure. */
export async function tableExists(db: Admin, table: string): Promise<boolean> {
  const r = await db.from(table).select('id').limit(1);
  if (isMissingTable(r)) return false;
  if (r.error) throw new Error(`${table} check failed: ${r.error.message}`);
  return true;
}

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
    const { data, error } = await this.db.from('delivery_quotes').select('id').eq('booking_group_id', bookingGroupId).neq('status', 'superseded').order('created_at');
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
    return tableExists(this.db, 'delivery_quotes');
  }

  /**
   * A return pickup the renter asked for during the hire and staff have not
   * confirmed yet (requested, still unpaid): at most one per order.
   */
  async pendingReturnRequest(renterId: string, bookingIds: readonly string[]): Promise<CustomerDeliveryQuote | null> {
    if (bookingIds.length === 0) return null;
    const { data, error } = await this.db
      .from('delivery_quotes')
      .select('id')
      .eq('renter_id', renterId)
      .eq('leg', 'return')
      .is('booking_group_id', null)
      .not('requested_at', 'is', null)
      .in('status', ['active', 'expired'])
      .overlaps('booking_ids', [...bookingIds])
      .order('requested_at', { ascending: false })
      .limit(1);
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw new Error(`pending return request failed: ${error.message}`);
    }
    const id = ((data ?? []) as { id: string }[])[0]?.id;
    return id ? new SupabaseDeliveryRepository(this.db).getQuote(id) : null;
  }

  /** Record the renter's request on the quote, once. True when this call recorded it. */
  async markRequested(quoteId: string, at: string): Promise<boolean> {
    const { data, error } = await this.db.from('delivery_quotes').update({ requested_at: at, updated_at: at }).eq('id', quoteId).is('requested_at', null).eq('status', 'active').select('id');
    if (error) throw new Error(`mark return request failed: ${error.message}`);
    return (data ?? []).length === 1;
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

/** Milliseconds east of UTC for an offset like '+02:00' (DELIVERY_CHECKOUT.utcOffset). Throws on anything else. */
export function utcOffsetMs(offset: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) throw new Error(`invalid UTC offset: ${offset}`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/** The calendar day of an instant in the studio's zone (finding 9: from the constant, never a hard-coded +2h). */
export function studioDay(iso: string, offset: string = DELIVERY_CHECKOUT.utcOffset): string {
  return new Date(new Date(iso).getTime() + utcOffsetMs(offset)).toISOString().slice(0, 10);
}

const sastDay = (iso: string): string => studioDay(iso);

/**
 * Whether a stored quote still describes this cart: the same listings, units
 * and hire days, and a window on the day the leg runs (the first hire day out,
 * the last one back). Quotes recorded before the line snapshot existed are
 * compared on listings and the leg day.
 */
export function quoteMatchesCart(q: Pick<CustomerDeliveryQuote, 'rentalIds' | 'lines' | 'leg' | 'window'>, lines: readonly DeliveryLineInput[]): boolean {
  if (!sameSet(q.rentalIds, lines.map((l) => l.rentalId))) return false;
  if (q.lines && q.lines.length > 0) {
    const cart = lines.map((l) => ({ rentalId: l.rentalId, quantity: Math.max(1, l.quantity), startDate: (l.startDate ?? '').slice(0, 10), endDate: (l.endDate ?? '').slice(0, 10) }));
    if (!sameLineSnapshot(q.lines, cart)) return false;
  }
  const day = legDate(lines.map((l) => ({ startDate: l.startDate ?? '', endDate: l.endDate ?? '' })), q.leg);
  if (q.window.start && day && sastDay(q.window.start) !== day) return false;
  return true;
}

/** The same window (same SAST times) moved to another day. */
export function windowOnDay(win: DeliveryWindow, dateYmd: string): DeliveryWindow {
  if (!win.start || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return win;
  const shift = new Date(`${dateYmd}T00:00:00${DELIVERY_CHECKOUT.utcOffset}`).getTime() - new Date(`${sastDay(win.start)}T00:00:00${DELIVERY_CHECKOUT.utcOffset}`).getTime();
  const move = (iso: string | null): string | null => (iso ? new Date(new Date(iso).getTime() + shift).toISOString() : null);
  return { start: move(win.start), end: move(win.end) };
}

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

  // A quote is stale when the cart changed (items, units or dates), or another order already holds it.
  const stale = qs.some((q) => !quoteMatchesCart(q, input.lines) || (q.bookingGroupId !== null && q.bookingGroupId !== (input.bookingGroupId ?? null)));

  if (!stale) {
    const check = await priceDeliveryForCheckout({ renterId: input.renterId, quoteIds: qs.map((q) => q.id), browserAmountCents: input.approvedCents }, deps);
    if (check.ok) return { ok: true, amountCents: check.amountCents, quotes: qs, requoted: false };
    if (check.code === 'price_mismatch') {
      return { ok: false, status: 409, code: 'DELIVERY_PRICE_CHANGED', message: check.message, amountCents: sum(qs), quotes: qs };
    }
    if (check.code !== 'quote_expired' && check.code !== 'quote_not_active') return invalid(check.message);
  }

  // Re-quote every leg for the same addresses and window slot, on the day the
  // leg now runs (D07): a changed date moves the window with it.
  const fresh: CustomerDeliveryQuote[] = [];
  for (const old of qs) {
    const day = legDate(input.lines.map((l) => ({ startDate: l.startDate ?? '', endDate: l.endDate ?? '' })), old.leg);
    const r = await quoteDelivery(
      {
        caller: { kind: 'renter', userId: input.renterId },
        renterId: input.renterId,
        bookingGroupId: null,
        leg: old.leg,
        originAddressId: old.originAddressId,
        destinationAddressId: old.destinationAddressId,
        lines: input.lines,
        window: day ? windowOnDay(old.window, day) : old.window,
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
