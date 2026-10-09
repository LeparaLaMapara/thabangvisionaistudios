'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Trash2, Minus, Plus, ShoppingCart, ArrowRight, AlertTriangle, CalendarDays, RotateCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCart } from '@/providers/CartProvider';
import { calculateItemPrice, calculateIncludedVat, depositPerUnit } from '@/lib/cart/pricing';
import { TermsAcceptance } from '@/components/consent/TermsAcceptance';
import { quoteDelivery, isDeliveryQuote } from '@/lib/delivery/quote';
import AddressAutocomplete, { type AddressResult } from '@/components/ui/AddressAutocomplete';
import { RENTAL_POLICY, STUDIO } from '@/lib/constants';
import { DashboardSubTabs, ACTIVITY_TABS } from '@/components/dashboard/DashboardSubTabs';
import type { CartItemWithRental } from '@/types/cart';
import { isPaymentUrl } from '@/lib/payments/hosts';
import { formatRand } from '@/lib/format/money';
import { usePaymentsOpen } from '@/lib/payments/usePaymentsOpen';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';
import { RenterChecklist, useRenterReadiness } from '@/components/booking/BookingWidget';
import { collectionPoint } from '@/lib/rental/collection-point';
import { fromLocalYmd, hireDays } from '@/lib/rental/dates';

const MAX_QTY = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cart date ("2026-10-03", or an older timestamp) as the local calendar day. */
function cartDay(value: string | null): Date | null {
  return value ? fromLocalYmd(value.slice(0, 10)) : null;
}

/** The gear page with this item's dates, where its dates are changed. */
function editDatesHref(item: CartItemWithRental): string {
  const base = `/rentals/${encodeURIComponent(item.rental.category)}/${encodeURIComponent(item.rental.slug)}`;
  const q = new URLSearchParams();
  if (item.start_date && item.end_date) {
    q.set('start', item.start_date.slice(0, 10));
    q.set('end', item.end_date.slice(0, 10));
  }
  if (item.quantity > 1) q.set('qty', String(item.quantity));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

const fmtDay = (d: Date): string => d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

type CheckoutError = {
  message: string;
  action?: { href: string; label: string } | { onClick: () => void; label: string };
};

type CancelState =
  | { kind: 'none' }
  | { kind: 'releasing' }
  | { kind: 'released'; restored: number }
  | { kind: 'already_paid'; bookingId: string | null }
  | { kind: 'hold_kept'; bookingId: string | null }
  | { kind: 'failed' }
  | { kind: 'generic' };

export default function CartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useCart();
  // Whether card payment is open (onlinePaymentsOpen on the server). While it
  // is closed the button sends a request and says so; nothing else changes.
  const paymentsOpen = usePaymentsOpen();

  const [items, setItems] = useState<CartItemWithRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [notes, setNotes] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  // The current documents were already accepted (GET /api/consent).
  const [acceptedBefore, setAcceptedBefore] = useState(false);
  const [fulfilment, setFulfilment] = useState<'collection' | 'delivery'>('collection');
  const [payNow, setPayNow] = useState<'full' | 'deposit_only'>('full');
  // While card payment is off: EFT to the business account, or cash when collecting.
  const [payBy, setPayBy] = useState<'eft' | 'cash'>('eft');
  const [address, setAddress] = useState<AddressResult | null>(null);
  const [cartVersion, setCartVersion] = useState(0);
  const [cancel, setCancel] = useState<CancelState>(() =>
    searchParams.get('payment') === 'cancelled' ? (UUID.test(searchParams.get('order') ?? '') ? { kind: 'releasing' } : { kind: 'generic' }) : { kind: 'none' },
  );

  const fetchCart = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch('/api/cart');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setItems((data.items ?? []) as CartItemWithRental[]);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Back from the payment page without paying: release the unpaid hold and
  // put the items back (POST /api/cart/cancel), then show the cart.
  const cancelStarted = useRef(false);
  const releaseCancelledOrder = useCallback(async (order: string) => {
    setCancel({ kind: 'releasing' });
    try {
      const res = await fetch('/api/cart/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkout_group_id: order }),
      });
      const data = await res.json().catch(() => ({}));
      let settled = true;
      if (res.ok && data.released) setCancel({ kind: 'released', restored: Number(data.restored ?? 0) });
      else if (data.code === 'ALREADY_PAID') setCancel({ kind: 'already_paid', bookingId: data.booking_id ?? null });
      else if (data.code === 'HOLD_KEPT') setCancel({ kind: 'hold_kept', bookingId: data.booking_id ?? null });
      else {
        settled = false;
        setCancel({ kind: 'failed' });
      }
      // Done once: a reload of this page must not put removed items back.
      if (settled) router.replace('/dashboard/cart', { scroll: false });
    } catch {
      setCancel({ kind: 'failed' });
    }
    await fetchCart();
    setCartVersion((v) => v + 1);
    void refresh();
  }, [fetchCart, refresh, router]);

  const cancelledOrder = searchParams.get('payment') === 'cancelled' ? searchParams.get('order') : null;
  useEffect(() => {
    if (cancelledOrder && UUID.test(cancelledOrder)) {
      if (cancelStarted.current) return;
      cancelStarted.current = true;
      void releaseCancelledOrder(cancelledOrder);
      return;
    }
    void fetchCart();
  }, [cancelledOrder, fetchCart, releaseCancelledOrder]);

  // Returning customers who already accepted the current Terms, Privacy
  // Policy and rental agreement are not asked to tick again on every try.
  // The checkout still requires and records the acceptance for this order.
  useEffect(() => {
    let active = true;
    fetch('/api/consent?context=checkout')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { missing?: unknown[] } | null) => {
        if (active && data && Array.isArray(data.missing) && data.missing.length === 0) {
          setAcceptedBefore(true);
          setAcceptTerms(true);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // What the renter still needs before paying (the checkout re-checks all of it).
  const { readiness, reload: reloadReadiness } = useRenterReadiness(
    !loading && items.length > 0 ? `v=${cartVersion}` : null,
  );
  const deliveryBlocked = !!readiness?.collectionRequired;
  useEffect(() => {
    if (deliveryBlocked) setFulfilment('collection');
  }, [deliveryBlocked]);

  const lines = useMemo(
    () =>
      items.map((item) => {
        const start = cartDay(item.start_date);
        const end = cartDay(item.end_date);
        const days = start && end ? hireDays(start, end) : 0;
        return { item, start, end, days, valid: !!start && !!end && days > 0 && days <= STUDIO.rental.maxBookingDays };
      }),
    [items],
  );
  const allDatesSet = lines.length > 0 && lines.every((l) => l.valid);

  const pricing = useMemo(() => {
    if (lines.length === 0 || !allDatesSet) return null;

    const totalItemCount = lines.reduce((sum, l) => sum + l.item.quantity, 0);

    const pricingItems = lines.map(({ item, days }) => {
      const unitPrice = calculateItemPrice(item.rental.price_per_day, item.rental.price_per_week, days);
      return {
        rental_id: item.rental_id,
        title: item.rental.title,
        quantity: item.quantity,
        days,
        unitPrice,
        subtotal: unitPrice * item.quantity,
        deposit: depositPerUnit(item.rental) * item.quantity,
      };
    });

    const subtotal = pricingItems.reduce((sum, pi) => sum + pi.subtotal, 0);
    const totalDeposit = pricingItems.reduce((sum, pi) => sum + pi.deposit, 0);

    let bulkDiscountPercent = 0;
    for (const tier of STUDIO.rental.bulkDiscount) {
      if (totalItemCount >= tier.minItems && totalItemCount <= tier.maxItems) {
        bulkDiscountPercent = tier.discountPercent;
        break;
      }
    }

    const bulkDiscountAmount = Math.round(subtotal * (bulkDiscountPercent / 100) * 100) / 100;

    return {
      items: pricingItems,
      itemCount: totalItemCount,
      subtotal,
      bulkDiscountPercent,
      bulkDiscountAmount,
      totalDeposit,
      vatRate: STUDIO.booking.vatRate,
      vatAmount: calculateIncludedVat(subtotal - bulkDiscountAmount),
      grandTotal: subtotal - bulkDiscountAmount + totalDeposit,
    };
  }, [lines, allDatesSet]);

  // Same pure function the server uses to charge, so the figure shown here is
  // the figure billed. The server recalculates it regardless.
  const delivery = useMemo(() => {
    if (fulfilment !== 'delivery' || !pricing) return null;
    return quoteDelivery({
      destination:
        address?.lat != null && address?.lng != null
          ? { lat: address.lat, lng: address.lng }
          : null,
      itemCount: pricing.itemCount,
    });
  }, [fulfilment, address, pricing]);

  const deliveryFee = delivery && isDeliveryQuote(delivery) ? delivery.fee : 0;

  const totals = useMemo(() => {
    if (!pricing) return null;
    const hireCharge = pricing.subtotal - pricing.bulkDiscountAmount;
    // Paying by EFT or cash covers the whole order; the deposit-first plan is
    // for card payment only.
    const balanceOnCollection = paymentsOpen !== false && payNow === 'deposit_only' ? hireCharge : 0;
    return {
      balanceOnCollection,
      dueNow:
        Math.round((pricing.grandTotal + deliveryFee - balanceOnCollection) * 100) / 100,
    };
  }, [pricing, deliveryFee, payNow, paymentsOpen]);

  // A delivery cannot proceed until we have a locatable address.
  const fulfilmentReady =
    fulfilment === 'collection' || (delivery !== null && isDeliveryQuote(delivery));

  const handleQuantityChange = async (itemId: string, newQty: number) => {
    if (newQty < 1 || newQty > MAX_QTY) return;
    const before = items;
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, quantity: newQty } : item)));
    setError(null);
    try {
      const res = await fetch('/api/cart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, quantity: newQty }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setCartVersion((v) => v + 1);
    } catch {
      setItems(before);
      setError({ message: 'Could not change the quantity. Please try again.' });
    }
  };

  const handleRemove = async (itemId: string) => {
    const before = items;
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    setError(null);
    try {
      const res = await fetch(`/api/cart?item_id=${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      setCartVersion((v) => v + 1);
    } catch {
      setItems(before);
      setError({ message: 'Could not remove that item. Please try again.' });
    }
    void refresh();
  };

  // One key per checkout attempt: a double click or a retry after a timeout
  // reaches the server as the same order, which it places only once.
  const checkoutKey = useRef<string>(crypto.randomUUID());

  /** A refusal from the checkout, with the step that fixes it. */
  const explain = (status: number, data: { error?: string; code?: string }): CheckoutError => {
    const message = data.error ?? 'Checkout failed.';
    const first = items[0];
    switch (data.code) {
      case 'ID_REQUIRED':
        return { message, action: { href: `/dashboard/verification?redirect=${encodeURIComponent('/dashboard/cart')}`, label: 'Do the ID check' } };
      case 'ID_PENDING':
        return { message, action: { href: '/dashboard/verification', label: 'See your ID check' } };
      case 'collection_only':
        return { message, action: { onClick: () => { setFulfilment('collection'); setError(null); }, label: 'Switch to Collect' } };
      case 'not_eligible': {
        const fix = readiness?.missing.find((m) => m.href && m.status === 'missing');
        return { message, action: fix?.href ? { href: fix.href, label: fix.label } : { href: '/contact', label: 'Contact us' } };
      }
      case 'trust_limit':
      case 'account_hold':
        return { message, action: { href: '/contact', label: 'Contact us' } };
      case 'UNAVAILABLE':
        return { message, action: first ? { href: editDatesHref(first), label: 'Choose other dates' } : undefined };
      default:
        if (status === 409 && first) return { message, action: { href: editDatesHref(first), label: 'Choose other dates' } };
        return { message };
    }
  };

  const handleCheckout = async () => {
    if (!allDatesSet) {
      setError({ message: 'Choose dates for each item on its page first.' });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': checkoutKey.current },
        body: JSON.stringify({
          notes: notes.trim() || undefined,
          acceptTerms,
          fulfilment_method: fulfilment,
          payment_plan: fulfilment === 'collection' ? payNow : 'full',
          payment_method: fulfilment === 'collection' ? payBy : 'eft',
          ...(fulfilment === 'delivery' && address
            ? {
                delivery_address: [
                  address.streetAddress,
                  address.city,
                  address.province,
                  address.postalCode,
                ]
                  .filter(Boolean)
                  .join(', '),
                delivery_lat: address.lat,
                delivery_lng: address.lng,
              }
            : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.code === 'DUPLICATE_REQUEST' && data.checkout_group_id) {
          // Already placed by an earlier click: show it instead of a second order.
          router.push(`/dashboard/bookings?checkout=${data.checkout_group_id}`);
          return;
        }
        setError(explain(res.status, data));
        if (res.status === 403) reloadReadiness();
        setSubmitting(false);
        return;
      }
      checkoutKey.current = crypto.randomUUID();

      if (data.payment_url) {
        try {
          if (!isPaymentUrl(data.payment_url)) {
            throw new Error('Invalid payment URL');
          }
          await refresh();
          window.location.href = data.payment_url;
        } catch {
          setError({ message: 'Invalid payment URL received. Please try again.' });
          setSubmitting(false);
        }
        return;
      }

      await refresh();
      // Paying by EFT or cash: straight to the booking, which shows how to pay.
      router.push(
        data.payments_offline && data.booking_id
          ? `/dashboard/bookings/${data.booking_id}`
          : `/dashboard/bookings?checkout=${data.checkout_group_id}`,
      );
    } catch {
      setError({ message: 'Something went wrong. Please try again.' });
      setSubmitting(false);
    }
  };

  const cancelBanner = (() => {
    switch (cancel.kind) {
      case 'releasing':
        return <div role="status" className="p-3 border border-white/10 text-neutral-400 text-xs font-mono">Payment was cancelled. Releasing your dates…</div>;
      case 'released':
        return (
          <div role="status" className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>
              Payment was cancelled and nothing was charged. We released the hold on your dates and put
              {cancel.restored === 1 ? ' the item' : ' the items'} back in your cart. The dates are held again only when you check out.
            </span>
          </div>
        );
      case 'already_paid':
        return (
          <div role="status" className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>
              That order is already paid.{' '}
              <Link href={cancel.bookingId ? `/dashboard/bookings/${cancel.bookingId}` : '/dashboard/bookings'} className="underline underline-offset-4">
                See your booking
              </Link>
            </span>
          </div>
        );
      case 'hold_kept':
        return (
          <div role="status" className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>
              Payment was cancelled and nothing was charged. Your booking is still waiting for payment and keeps the dates for now.{' '}
              <Link href={cancel.bookingId ? `/dashboard/bookings/${cancel.bookingId}` : '/dashboard/bookings'} className="underline underline-offset-4">
                Open it to cancel it
              </Link>{' '}
              before booking again.
            </span>
          </div>
        );
      case 'failed':
        return (
          <div role="alert" className="flex items-center justify-between gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
            <span>Payment was cancelled, but we could not release your dates just now.</span>
            {cancelledOrder && (
              <button
                type="button"
                onClick={() => void releaseCancelledOrder(cancelledOrder)}
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 uppercase tracking-widest text-[#D4A843]"
              >
                <RotateCw className="w-3 h-3" aria-hidden="true" /> Retry
              </button>
            )}
          </div>
        );
      case 'generic':
        return (
          <div role="status" className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>
              Payment was cancelled and nothing was charged. An unpaid booking is released when its hold runs out; see{' '}
              <Link href="/dashboard/bookings" className="underline underline-offset-4">My Rentals</Link>.
            </span>
          </div>
        );
      default:
        return null;
    }
  })();

  if (loading) {
    return (
      <div className="space-y-4">
        {cancelBanner}
        <div className="flex items-center justify-center py-20" role="status" aria-label="Loading your cart">
          <div className="w-6 h-6 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="text-center py-20 space-y-4">
        {cancelBanner}
        <p role="alert" className="text-sm font-mono text-red-400">We could not load your cart.</p>
        <button
          type="button"
          onClick={() => void fetchCart()}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 border border-white/10 text-xs font-mono uppercase tracking-widest text-[#D4A843]"
        >
          <RotateCw className="w-3 h-3" aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-20 space-y-4">
        {cancelBanner}
        <ShoppingCart className="w-12 h-12 mx-auto text-neutral-400" aria-hidden="true" />
        <p className="text-sm font-mono text-neutral-400">Your cart is empty</p>
        <Link
          href="/rentals"
          className="inline-flex items-center gap-2 min-h-[44px] text-xs font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:underline"
        >
          Browse Equipment <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const blockedByChecks = !!readiness && !readiness.ok;
  const docs = STUDIO.legal.documents;

  return (
    <div className="space-y-8">
      <DashboardSubTabs tabs={ACTIVITY_TABS} />
      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
          Rental Cart
        </p>
        <h2 className="text-xl font-display font-medium text-white">
          {items.length} item{items.length !== 1 ? 's' : ''} in cart
        </h2>
      </div>

      {cancelBanner}

      {error && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono space-y-1">
          <p>{error.message}</p>
          {error.action &&
            ('href' in error.action ? (
              <Link href={error.action.href} className="inline-flex items-center min-h-[44px] underline underline-offset-4 text-[#D4A843]">
                {error.action.label}
              </Link>
            ) : (
              <button type="button" onClick={error.action.onClick} className="inline-flex items-center min-h-[44px] underline underline-offset-4 text-[#D4A843]">
                {error.action.label}
              </button>
            ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* Cart items. Dates were chosen on each item's page and are changed there. */}
        <ul className="space-y-3" aria-label="Items in your cart">
          {lines.map(({ item, start, end, days, valid }) => {
            const itemTotal = valid
              ? calculateItemPrice(item.rental.price_per_day, item.rental.price_per_week, days) * item.quantity
              : 0;
            const gearHref = editDatesHref(item);

            return (
              <motion.li
                key={item.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-4 border border-white/10 bg-[#0A0A0B] space-y-3"
              >
                <div className="flex gap-4">
                  {/* Thumbnail */}
                  <div className="w-20 h-20 flex-shrink-0 bg-neutral-900 overflow-hidden">
                    {item.rental.thumbnail_url ? (
                      <Image
                        src={item.rental.thumbnail_url}
                        alt={item.rental.title}
                        width={80}
                        height={80}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-400 text-xs font-mono">
                        No image
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/rentals/${encodeURIComponent(item.rental.category)}/${encodeURIComponent(item.rental.slug)}`}
                      className="text-sm font-mono font-medium text-white hover:text-[#D4A843] transition-colors truncate block"
                    >
                      {item.rental.title}
                    </Link>
                    <p className="text-xs font-mono text-neutral-400 mt-0.5">
                      {item.rental.category}{item.rental.brand ? ` / ${item.rental.brand}` : ''}
                    </p>
                    <p className="text-xs font-mono text-neutral-400 mt-1">
                      {formatRand(item.rental.price_per_day)} a day
                      {item.rental.price_per_week ? ` · ${formatRand(item.rental.price_per_week)} a week` : ''}
                    </p>

                    {/* Quantity controls */}
                    <div className="flex items-center gap-1 mt-2" role="group" aria-label={`Quantity of ${item.rental.title}`}>
                      <button
                        type="button"
                        onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        aria-label={`One fewer ${item.rental.title}`}
                        className="w-11 h-11 flex items-center justify-center border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 disabled:opacity-30 transition-colors"
                      >
                        <Minus className="w-3 h-3" aria-hidden="true" />
                      </button>
                      <span className="text-xs font-mono text-white w-8 text-center" aria-live="polite">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                        disabled={item.quantity >= MAX_QTY}
                        aria-label={`One more ${item.rental.title}`}
                        className="w-11 h-11 flex items-center justify-center border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 disabled:opacity-30 transition-colors"
                      >
                        <Plus className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Remove + Item total */}
                  <div className="flex flex-col items-end justify-between">
                    <button
                      type="button"
                      onClick={() => handleRemove(item.id)}
                      aria-label={`Remove ${item.rental.title} from your cart`}
                      className="w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                    {valid && (
                      <p className="text-xs font-mono font-bold text-white">
                        {formatRand(itemTotal)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Dates, read-only: chosen once, on the item's page */}
                <div className="border-t border-white/5 pt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-mono text-neutral-300 flex items-center gap-2">
                    <CalendarDays className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
                    {start && end ? (
                      <span>
                        {fmtDay(start)} to {fmtDay(end)}
                        {valid ? ` · ${days} day${days !== 1 ? 's' : ''}` : ''}
                      </span>
                    ) : (
                      <span className="text-amber-400">No dates chosen yet</span>
                    )}
                  </p>
                  <Link
                    href={gearHref}
                    aria-label={`${start && end ? 'Edit dates' : 'Choose dates'} for ${item.rental.title}`}
                    className="min-h-[44px] inline-flex items-center text-xs font-mono uppercase tracking-widest text-[#D4A843] underline underline-offset-4"
                  >
                    {start && end ? 'Edit dates' : 'Choose dates'}
                  </Link>
                  {start && end && !valid && (
                    <p className="w-full text-xs font-mono text-amber-400">
                      These dates cannot be booked as they are. Choose a return day after the pick-up day, at most {STUDIO.rental.maxBookingDays} days later.
                    </p>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ul>

        {/* Sidebar: Pricing + Checkout */}
        <div className="space-y-5 lg:sticky lg:top-28 self-start">
          {/* Pricing breakdown */}
          {pricing && (
            <div className="border border-white/10 bg-[#0A0A0B] p-5 space-y-3">
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Pricing
              </p>

              {pricing.items.map((pi) => (
                <div key={pi.rental_id} className="flex justify-between text-xs font-mono">
                  <span className="text-neutral-400 truncate mr-2">
                    {pi.title} {pi.quantity > 1 ? `x${pi.quantity}` : ''} · {pi.days}d
                  </span>
                  <span className="text-white flex-shrink-0">
                    {formatRand(pi.subtotal)}
                  </span>
                </div>
              ))}

              <div className="border-t border-white/5 pt-3 flex justify-between text-xs font-mono">
                <span className="text-neutral-400">Subtotal</span>
                <span className="text-white">{formatRand(pricing.subtotal)}</span>
              </div>

              {pricing.bulkDiscountPercent > 0 && (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-emerald-400">
                    Bulk discount ({pricing.bulkDiscountPercent}%)
                  </span>
                  <span className="text-emerald-400">
                    -{formatRand(pricing.bulkDiscountAmount)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-xs font-mono">
                <span className="text-neutral-400">Deposits</span>
                <span className="text-neutral-400">{formatRand(pricing.totalDeposit)}</span>
              </div>

              {STUDIO.legal.vatRegistered && (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-neutral-400">
                    Incl. VAT ({pricing.vatRate}%)
                  </span>
                  <span className="text-neutral-400">{formatRand(pricing.vatAmount)}</span>
                </div>
              )}

              {deliveryFee > 0 && (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-neutral-400">Delivery</span>
                  <span className="text-neutral-400">{formatRand(deliveryFee)}</span>
                </div>
              )}

              <div className="border-t border-white/10 pt-3 flex justify-between text-sm font-mono font-bold">
                <span className="text-white">
                  {totals && totals.balanceOnCollection > 0 ? (paymentsOpen === false ? 'To pay first' : 'Pay now') : 'Total'}
                </span>
                <span className="text-[#D4A843]">
                  {formatRand(totals?.dueNow ?? pricing.grandTotal)}
                </span>
              </div>

              {totals && totals.balanceOnCollection > 0 && (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-neutral-400">Due on collection</span>
                  <span className="text-neutral-400">
                    {formatRand(totals.balanceOnCollection)}
                  </span>
                </div>
              )}

              {pricing.bulkDiscountPercent > 0 && (
                <p className="text-xs font-mono text-emerald-400/70">
                  You save {formatRand(pricing.bulkDiscountAmount)} with bulk discount
                </p>
              )}
            </div>
          )}

          {!allDatesSet && items.length > 0 && (
            <div className="border border-white/10 bg-[#0A0A0B] p-5">
              <p className="text-xs font-mono text-neutral-400 text-center">
                Choose dates for each item on its page (Edit dates) to see the price.
              </p>
            </div>
          )}

          {/* How the customer gets the gear */}
          {items.length > 0 && (
            <div className="border border-white/10 bg-[#0A0A0B] p-5 space-y-4">
              <p id="fulfilment-label" className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                How would you like to receive your gear?
              </p>

              <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="fulfilment-label">
                {(['collection', 'delivery'] as const).map((method) => {
                  const disabled = method === 'delivery' && (deliveryBlocked || !STUDIO.fulfilment.delivery.enabled);
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setFulfilment(method)}
                      disabled={disabled}
                      aria-pressed={fulfilment === method}
                      aria-describedby={disabled ? 'delivery-reason' : undefined}
                      className={`min-h-[44px] border px-4 py-3 text-xs font-mono uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        fulfilment === method
                          ? 'border-[#D4A843] text-[#D4A843]'
                          : 'border-white/10 text-neutral-400 hover:border-white/30'
                      }`}
                    >
                      {method === 'collection' ? 'Collect' : 'Deliver'}
                    </button>
                  );
                })}
              </div>

              {(deliveryBlocked || !STUDIO.fulfilment.delivery.enabled) && (
                <p id="delivery-reason" className="text-xs font-mono text-neutral-400 leading-relaxed">
                  {!STUDIO.fulfilment.delivery.enabled
                    ? 'Delivery is not available at the moment.'
                    : [
                        readiness?.collectionReasons.includes('first_hire')
                          ? 'Your first hire is collected in person so we can check the gear with you. Delivery opens after your first clean return.'
                          : null,
                        readiness?.collectionReasons.includes('high_value_item')
                          ? `Items worth more than ${formatRand(Math.round(RENTAL_POLICY.highValueCollectionThresholdCents / 100))} are always collected in person.`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                </p>
              )}

              {fulfilment === 'collection' ? (
                <div className="space-y-3">
                  <p className="text-xs font-mono text-neutral-400 leading-relaxed">
                    Collect at {collectionPoint()}, {STUDIO.location.city}. {STUDIO.hours.weekday},{' '}
                    {STUDIO.hours.weekend}. Bring the ID you verified with.
                  </p>

                  {paymentsOpen === false && (
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                        How you pay
                      </legend>
                      {(
                        [
                          ['eft', `Pay by EFT within ${STUDIO.bank.payWithinHours} hours`],
                          ['cash', 'Pay cash when I collect'],
                        ] as const
                      ).map(([method, label]) => (
                        <label
                          key={method}
                          className="flex gap-3 text-xs font-mono text-neutral-400 cursor-pointer min-h-[44px] items-center"
                        >
                          <input
                            type="radio"
                            name="payment-method"
                            checked={payBy === method}
                            onChange={() => setPayBy(method)}
                            className="accent-[#D4A843]"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {paymentsOpen !== false && STUDIO.fulfilment.collection.allowBalanceOnCollection && (
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                        Payment
                      </legend>
                      {(
                        [
                          ['full', 'Pay everything now'],
                          ['deposit_only', 'Pay the deposit now, the rest on collection'],
                        ] as const
                      ).map(([plan, label]) => (
                        <label
                          key={plan}
                          className="flex gap-3 text-xs font-mono text-neutral-400 cursor-pointer min-h-[44px] items-center"
                        >
                          <input
                            type="radio"
                            name="payment-plan"
                            checked={payNow === plan}
                            onChange={() => setPayNow(plan)}
                            className="accent-[#D4A843]"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-mono text-neutral-400 leading-relaxed">
                    We deliver in our own vehicle. The fee is worked out from the distance
                    and the size of your order, and shown below before you book.
                  </p>

                  <AddressAutocomplete onSelect={setAddress} />

                  {delivery && !isDeliveryQuote(delivery) && address && (
                    <p className="text-xs font-mono text-amber-400 leading-relaxed">
                      {delivery.reason === 'out_of_range'
                        ? `That address is about ${delivery.distanceKm}km away, past our ${delivery.maxRadiusKm}km delivery radius. Choose Collect, or contact us for a delivery quote.`
                        : 'Pick your address from the suggestions so we can work out the distance.'}
                    </p>
                  )}

                  {delivery && isDeliveryQuote(delivery) && (
                    <p className="text-xs font-mono text-neutral-400">
                      About {delivery.distanceKm}km from our {delivery.fromLocation} collection point.
                      {delivery.minimumApplied && ' Minimum delivery fee applied.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Everything the renter needs, before the button that commits */}
          {readiness && (!readiness.ok || readiness.requiresManualApproval) && (
            <RenterChecklist readiness={readiness} back="/dashboard/cart" />
          )}

          {/* Notes */}
          <div>
            <label htmlFor="cart-notes" className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
              Notes for collection or delivery (optional)
            </label>
            <textarea
              id="cart-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="For example, who is collecting or a gate code"
              maxLength={500}
              rows={2}
              className="w-full bg-transparent border border-white/10 p-3 text-xs font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none resize-none"
            />
          </div>

          {/* Payment truth, above the button that commits */}
          <PaymentsNotOpenNote open={paymentsOpen} />

          {/* Required acceptance, recorded by the checkout route for this order */}
          {acceptedBefore ? (
            <p className="text-xs font-mono text-neutral-300 leading-relaxed min-h-[44px] py-2">
              You accepted the{' '}
              <a href={docs.terms.href} target="_blank" rel="noopener noreferrer" className="text-[#D4A843] underline underline-offset-2">
                {docs.terms.label}
              </a>
              ,{' '}
              <a href={docs.privacy.href} target="_blank" rel="noopener noreferrer" className="text-[#D4A843] underline underline-offset-2">
                {docs.privacy.label}
              </a>{' '}
              and{' '}
              <a href={docs.rentalAgreement.href} target="_blank" rel="noopener noreferrer" className="text-[#D4A843] underline underline-offset-2">
                {docs.rentalAgreement.label.toLowerCase()}
              </a>{' '}
              (version {docs.terms.version}). Placing this order confirms they apply to this hire.
            </p>
          ) : (
            <TermsAcceptance checked={acceptTerms} onChange={setAcceptTerms} includeRentalAgreement />
          )}

          {/* Checkout button */}
          <Button
            onClick={handleCheckout}
            loading={submitting}
            disabled={!allDatesSet || items.length === 0 || !fulfilmentReady || !acceptTerms || blockedByChecks}
            className="w-full"
            size="lg"
          >
            {!pricing
              ? 'Choose dates to check out'
              : blockedByChecks
                ? 'Finish the steps above to pay'
                : !fulfilmentReady
                  ? 'Enter a delivery address'
                  : paymentsOpen === false
                    ? fulfilment === 'collection' && payBy === 'cash'
                      ? `Reserve, pay ${formatRand(totals?.dueNow ?? pricing.grandTotal)} cash on collection`
                      : `Book and pay by EFT, ${formatRand(totals?.dueNow ?? pricing.grandTotal)}`
                    : `Checkout, ${formatRand(totals?.dueNow ?? pricing.grandTotal)}`}
          </Button>

          <p className="text-xs font-mono text-neutral-400 text-center">
            Each item has its own rental period. Deposits are refundable and
            carry no VAT. Bulk discounts apply on 3+ items.
          </p>
        </div>
      </div>
    </div>
  );
}
