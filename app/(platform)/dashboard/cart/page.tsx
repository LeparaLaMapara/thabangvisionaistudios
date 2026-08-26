'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Trash2, Minus, Plus, ShoppingCart, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { useCart } from '@/providers/CartProvider';
import { calculateItemPrice, calculateIncludedVat } from '@/lib/cart/pricing';
import { STUDIO } from '@/lib/constants';
import { DashboardSubTabs, ACTIVITY_TABS } from '@/components/dashboard/DashboardSubTabs';
import type { CartItemWithRental } from '@/types/cart';

function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function CartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useCart();

  const [items, setItems] = useState<CartItemWithRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
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
        deposit: (item.rental.deposit_amount ?? 0) * item.quantity,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Checkout failed.');
        setSubmitting(false);
        return;
      }

      if (data.payment_url) {
        try {
          const payUrl = new URL(data.payment_url);
          const allowedHosts = [
            'sandbox.payfast.co.za', 'www.payfast.co.za',
            'checkout.paystack.com',
          ];
          if (!allowedHosts.includes(payUrl.hostname)) {
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
      router.push(`/dashboard/bookings?checkout=${data.checkout_group_id}`);
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
        <ShoppingCart className="w-12 h-12 mx-auto text-neutral-600" />
        <p className="text-sm font-mono text-neutral-500">Your cart is empty</p>
        <Link
          href="/rentals"
          className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:underline"
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
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
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
                      <div className="w-full h-full flex items-center justify-center text-neutral-700 text-[10px] font-mono">
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
                    <p className="text-[10px] font-mono text-neutral-500 mt-0.5">
                      {item.rental.category}{item.rental.brand ? ` / ${item.rental.brand}` : ''}
                    </p>
                    <p className="text-xs font-mono text-neutral-400 mt-1">
                      {item.rental.currency} {item.rental.price_per_day}/day
                      {item.rental.price_per_week ? ` · ${item.rental.currency} ${item.rental.price_per_week}/week` : ''}
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
                      className="text-neutral-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {hasDates && (
                      <p className="text-xs font-mono font-bold text-white">
                        R {itemTotal.toLocaleString()}
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
                    <p className="text-[10px] font-mono text-neutral-500 mt-1.5">
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
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                Pricing
              </p>

              {pricing.items.map((pi) => (
                <div key={pi.rental_id} className="flex justify-between text-xs font-mono">
                  <span className="text-neutral-400 truncate mr-2">
                    {pi.title} {pi.quantity > 1 ? `x${pi.quantity}` : ''} · {pi.days}d
                  </span>
                  <span className="text-white flex-shrink-0">
                    R {pi.subtotal.toLocaleString()}
                  </span>
                </div>
              ))}

              <div className="border-t border-white/5 pt-3 flex justify-between text-xs font-mono">
                <span className="text-neutral-500">Subtotal</span>
                <span className="text-white">R {pricing.subtotal.toLocaleString()}</span>
              </div>

              {pricing.bulkDiscountPercent > 0 && (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-emerald-400">
                    Bulk discount ({pricing.bulkDiscountPercent}%)
                  </span>
                  <span className="text-emerald-400">
                    -R {pricing.bulkDiscountAmount.toLocaleString()}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-xs font-mono">
                <span className="text-neutral-500">Deposits</span>
                <span className="text-neutral-400">R {pricing.totalDeposit.toLocaleString()}</span>
              </div>

              {STUDIO.legal.vatRegistered && (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-neutral-500">
                    Incl. VAT ({pricing.vatRate}%)
                  </span>
                  <span className="text-neutral-400">R {pricing.vatAmount.toLocaleString()}</span>
                </div>
              )}

              <div className="border-t border-white/10 pt-3 flex justify-between text-sm font-mono font-bold">
                <span className="text-white">Total</span>
                <span className="text-[#D4A843]">R {pricing.grandTotal.toLocaleString()}</span>
              </div>

              {pricing.bulkDiscountPercent > 0 && (
                <p className="text-[9px] font-mono text-emerald-400/70">
                  You save R {pricing.bulkDiscountAmount.toLocaleString()} with bulk discount
                </p>
              )}
            </div>
          )}

          {!allDatesSet && items.length > 0 && (
            <div className="border border-white/10 bg-[#0A0A0B] p-5">
              <p className="text-xs font-mono text-neutral-500 text-center">
                Select rental dates for each item to see pricing
              </p>
            </div>
          )}

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Pickup/delivery notes (optional)"
            maxLength={500}
            rows={2}
            className="w-full bg-transparent border border-white/10 p-3 text-xs font-mono text-white placeholder:text-neutral-600 focus:border-[#D4A843]/50 focus:outline-none resize-none"
          />

          {/* Checkout button */}
          <Button
            onClick={handleCheckout}
            loading={submitting}
            disabled={!allDatesSet || items.length === 0}
            className="w-full"
            size="lg"
          >
            {pricing
              ? `Checkout — R ${pricing.grandTotal.toLocaleString()}`
              : 'Select Dates to Checkout'}
          </Button>

          <p className="text-[9px] font-mono text-neutral-600 text-center">
            Each item has its own rental period. Deposits are refundable and
            carry no VAT. Bulk discounts apply on 3+ items.
          </p>
        </div>
      </div>
    </div>
  );
}
