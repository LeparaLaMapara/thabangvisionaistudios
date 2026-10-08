'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Trash2, Minus, Plus, ShoppingCart, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { useCart } from '@/providers/CartProvider';
import { calculateItemPrice, calculateIncludedVat, depositPerUnit } from '@/lib/cart/pricing';
import { TermsAcceptance } from '@/components/consent/TermsAcceptance';
import { quoteDelivery, isDeliveryQuote } from '@/lib/delivery/quote';
import AddressAutocomplete, { type AddressResult } from '@/components/ui/AddressAutocomplete';
import { STUDIO } from '@/lib/constants';
import { DashboardSubTabs, ACTIVITY_TABS } from '@/components/dashboard/DashboardSubTabs';
import type { CartItemWithRental } from '@/types/cart';
import { isPaymentUrl } from '@/lib/payments/hosts';
import { formatRand } from '@/lib/format/money';
import { usePaymentsOpen } from '@/lib/payments/usePaymentsOpen';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';
import { collectionPoint } from '@/lib/rental/collection-point';

function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function CartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useCart();
  // Whether card payment is open (onlinePaymentsOpen on the server). While it
  // is closed the button sends a request and says so; nothing else changes.
  const paymentsOpen = usePaymentsOpen();

  const [items, setItems] = useState<CartItemWithRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [fulfilment, setFulfilment] = useState<'collection' | 'delivery'>('collection');
  const [payNow, setPayNow] = useState<'full' | 'deposit_only'>('full');
  // While card payment is off: EFT to the business account, or cash when collecting.
  const [payBy, setPayBy] = useState<'eft' | 'cash'>('eft');
  const [address, setAddress] = useState<AddressResult | null>(null);
  const [itemDates, setItemDates] = useState<Map<string, DateRange>>(new Map());

  const paymentCancelled = searchParams.get('payment') === 'cancelled';

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  useEffect(() => {
    async function fetchCart() {
      try {
        const res = await fetch('/api/cart');
        if (res.ok) {
          const data = await res.json();
          const cartItems: CartItemWithRental[] = data.items ?? [];
          setItems(cartItems);

          const dates = new Map<string, DateRange>();
          for (const item of cartItems) {
            dates.set(item.id, {
              start: item.start_date ? new Date(item.start_date) : null,
              end: item.end_date ? new Date(item.end_date) : null,
            });
          }
          setItemDates(dates);
        }
      } catch {
        setError('Failed to load cart.');
      } finally {
        setLoading(false);
      }
    }
    fetchCart();
  }, []);

  const allDatesSet = useMemo(() => {
    if (items.length === 0) return false;
    return items.every((item) => {
      const d = itemDates.get(item.id);
      return d?.start && d?.end;
    });
  }, [items, itemDates]);

  const pricing = useMemo(() => {
    if (items.length === 0 || !allDatesSet) return null;

    const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    const pricingItems = items.map((item) => {
      const dates = itemDates.get(item.id)!;
      const days = daysBetween(dates.start!, dates.end!);
      const unitPrice = calculateItemPrice(
        item.rental.price_per_day,
        item.rental.price_per_week,
        days,
      );

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
  }, [items, itemDates, allDatesSet]);

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

  const handleDateChange = async (itemId: string, range: DateRange) => {
    setItemDates((prev) => new Map(prev).set(itemId, range));
    setError(null);

    if (range.start && range.end) {
      const startStr = range.start.toISOString().split('T')[0];
      const endStr = range.end.toISOString().split('T')[0];

      await fetch('/api/cart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, start_date: startStr, end_date: endStr }),
      });
    }
  };

  const handleQuantityChange = async (itemId: string, newQty: number) => {
    if (newQty < 1 || newQty > 5) return;

    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, quantity: newQty } : item)),
    );

    await fetch('/api/cart', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, quantity: newQty }),
    });
  };

  const handleRemove = async (itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    setItemDates((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
    await fetch(`/api/cart?item_id=${itemId}`, { method: 'DELETE' });
    refresh();
  };

  // One key per checkout attempt: a double click or a retry after a timeout
  // reaches the server as the same order, which it places only once.
  const checkoutKey = useRef<string>(crypto.randomUUID());

  const handleCheckout = async () => {
    if (!allDatesSet) {
      setError('Please select rental dates for all items.');
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

      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'DUPLICATE_REQUEST' && data.checkout_group_id) {
          // Already placed by an earlier click: show it instead of a second order.
          router.push(`/dashboard/bookings?checkout=${data.checkout_group_id}`);
          return;
        }
        setError(data.error ?? 'Checkout failed.');
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
          setError('Invalid payment URL received. Please try again.');
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
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-neutral-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-20 space-y-4">
        <ShoppingCart className="w-12 h-12 mx-auto text-neutral-400" />
        <p className="text-sm font-mono text-neutral-400">Your cart is empty</p>
        <Link
          href="/rentals"
          className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:underline"
        >
          Browse Equipment <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

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

      {paymentCancelled && (
        <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-mono">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Payment was cancelled. Your cart items have been restored.
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* Cart Items with per-item date pickers */}
        <div className="space-y-3">
          {items.map((item) => {
            const dates = itemDates.get(item.id) ?? { start: null, end: null };
            const hasDates = !!dates.start && !!dates.end;
            const days = hasDates ? daysBetween(dates.start!, dates.end!) : 0;
            const itemTotal = hasDates
              ? calculateItemPrice(item.rental.price_per_day, item.rental.price_per_week, days) * item.quantity
              : 0;

            return (
              <motion.div
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
                      href={`/rentals/${item.rental.slug}`}
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
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        className="w-6 h-6 flex items-center justify-center border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 disabled:opacity-30 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-mono text-white w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                        disabled={item.quantity >= 5}
                        className="w-6 h-6 flex items-center justify-center border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 disabled:opacity-30 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Remove + Item total */}
                  <div className="flex flex-col items-end justify-between">
                    <button
                      onClick={() => handleRemove(item.id)}
                      className="text-neutral-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {hasDates && (
                      <p className="text-xs font-mono font-bold text-white">
                        {formatRand(itemTotal)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Per-item date picker */}
                <div className="border-t border-white/5 pt-3">
                  <DateRangePicker
                    value={dates}
                    onChange={(range) => handleDateChange(item.id, range)}
                    minDate={today}
                    label="Rental dates"
                  />
                  {hasDates && (
                    <p className="text-xs font-mono text-neutral-400 mt-1.5">
                      {days} day{days !== 1 ? 's' : ''}
                      {days >= 7 ? ` (${Math.floor(days / 7)}w ${days % 7}d)` : ''}
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

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
                Select rental dates for each item to see pricing
              </p>
            </div>
          )}

          {/* How the customer gets the gear */}
          {items.length > 0 && (
            <div className="border border-white/10 bg-[#0A0A0B] p-5 space-y-4">
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                How would you like to receive your gear?
              </p>

              <div className="grid grid-cols-2 gap-3">
                {(['collection', 'delivery'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setFulfilment(method)}
                    className={`min-h-[44px] border px-4 py-3 text-xs font-mono uppercase tracking-widest transition-colors ${
                      fulfilment === method
                        ? 'border-[#D4A843] text-[#D4A843]'
                        : 'border-white/10 text-neutral-400 hover:border-white/30'
                    }`}
                  >
                    {method === 'collection' ? 'Collect' : 'Deliver'}
                  </button>
                ))}
              </div>

              {fulfilment === 'collection' ? (
                <div className="space-y-3">
                  <p className="text-xs font-mono text-neutral-400 leading-relaxed">
                    Collect at {collectionPoint()}, {STUDIO.location.city}. {STUDIO.hours.weekday},{' '}
                    {STUDIO.hours.weekend}. Bring the ID you verified with.
                  </p>

                  {paymentsOpen === false && (
                    <div className="space-y-2">
                      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                        How you pay
                      </p>
                      {(
                        [
                          ['eft', `Pay by EFT within ${STUDIO.bank.payWithinHours} hours`],
                          ['cash', 'Pay cash when I collect'],
                        ] as const
                      ).map(([method, label]) => (
                        <label
                          key={method}
                          className="flex items-start gap-3 text-xs font-mono text-neutral-400 cursor-pointer min-h-[44px] items-center"
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
                    </div>
                  )}

                  {paymentsOpen !== false && STUDIO.fulfilment.collection.allowBalanceOnCollection && (
                    <div className="space-y-2">
                      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                        Payment
                      </p>
                      {(
                        [
                          ['full', 'Pay everything now'],
                          ['deposit_only', 'Pay the deposit now, the rest on collection'],
                        ] as const
                      ).map(([plan, label]) => (
                        <label
                          key={plan}
                          className="flex items-start gap-3 text-xs font-mono text-neutral-400 cursor-pointer min-h-[44px] items-center"
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
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-mono text-neutral-400 leading-relaxed">
                    We deliver in our own vehicle. The fee is worked out from the distance
                    and the size of your order, and shown below before you book. Your first
                    hire is collected in person.
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

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Pickup/delivery notes (optional)"
            maxLength={500}
            rows={2}
            className="w-full bg-transparent border border-white/10 p-3 text-xs font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none resize-none"
          />

          {/* Payment truth, above the button that commits */}
          <PaymentsNotOpenNote open={paymentsOpen} />

          {/* Required acceptance, recorded by the checkout route */}
          <TermsAcceptance checked={acceptTerms} onChange={setAcceptTerms} includeRentalAgreement />

          {/* Checkout button */}
          <Button
            onClick={handleCheckout}
            loading={submitting}
            disabled={!allDatesSet || items.length === 0 || !fulfilmentReady || !acceptTerms}
            className="w-full"
            size="lg"
          >
            {!pricing
              ? 'Select Dates to Checkout'
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
