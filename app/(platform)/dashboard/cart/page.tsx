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
import { STUDIO } from '@/lib/constants';
import type { CartItemWithRental, CartPricingSummary } from '@/types/cart';

export default function CartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useCart();

  const [items, setItems] = useState<CartItemWithRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null });
  const [notes, setNotes] = useState('');

  const paymentCancelled = searchParams.get('payment') === 'cancelled';

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const dayCount = useMemo(() => {
    if (!dateRange.start || !dateRange.end) return 0;
    const ms = dateRange.end.getTime() - dateRange.start.getTime();
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }, [dateRange]);

  // Client-side pricing calculation (mirrors server-side calculateCartPricing)
  const pricing: CartPricingSummary | null = useMemo(() => {
    if (items.length === 0 || dayCount <= 0) return null;

    const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    const pricingItems = items.map((item) => {
      const pricePerDay = item.rental.price_per_day;
      const pricePerWeek = item.rental.price_per_week;
      let unitPrice: number;

      if (pricePerWeek && dayCount >= 7) {
        const fullWeeks = Math.floor(dayCount / 7);
        const extraDays = dayCount % 7;
        unitPrice = fullWeeks * pricePerWeek + extraDays * pricePerDay;
      } else {
        unitPrice = dayCount * pricePerDay;
      }

      return {
        rental_id: item.rental_id,
        title: item.rental.title,
        quantity: item.quantity,
        days: dayCount,
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
      dayCount,
      subtotal,
      bulkDiscountPercent,
      bulkDiscountAmount,
      totalDeposit,
      grandTotal: subtotal - bulkDiscountAmount + totalDeposit,
    };
  }, [items, dayCount]);

  // Fetch cart items
  useEffect(() => {
    async function fetchCart() {
      try {
        const res = await fetch('/api/cart');
        if (res.ok) {
          const data = await res.json();
          setItems(data.items ?? []);
        }
      } catch {
        setError('Failed to load cart.');
      } finally {
        setLoading(false);
      }
    }
    fetchCart();
  }, []);

  const handleQuantityChange = async (itemId: string, newQty: number) => {
    if (newQty < 1 || newQty > 5) return;

    // Optimistic update
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
    await fetch(`/api/cart?item_id=${itemId}`, { method: 'DELETE' });
    refresh();
  };

  const handleCheckout = async () => {
    if (!dateRange.start || !dateRange.end) {
      setError('Please select rental dates.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: dateRange.start.toISOString().split('T')[0],
          end_date: dateRange.end.toISOString().split('T')[0],
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Checkout failed.');
        setSubmitting(false);
        return;
      }

      // Redirect to payment
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

      // No payment — redirect to bookings
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
          href="/smart-rentals"
          className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:underline"
        >
          Browse Equipment <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
          Equipment Cart
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
        {/* Cart Items */}
        <div className="space-y-3">
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex gap-4 p-4 border border-white/10 bg-[#0A0A0B]"
            >
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
                  href={`/smart-rentals/${item.rental.slug}`}
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

              {/* Remove */}
              <button
                onClick={() => handleRemove(item.id)}
                className="text-neutral-600 hover:text-red-400 transition-colors self-start"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </div>

        {/* Sidebar: Date picker + Pricing */}
        <div className="space-y-5 lg:sticky lg:top-28 self-start">
          <div className="border border-white/10 bg-[#0A0A0B] p-5 space-y-5">
            <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              Rental Period
            </p>
            <DateRangePicker
              label="Select dates for all items"
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setError(null);
              }}
              minDate={today}
            />

            {dayCount > 0 && (
              <p className="text-xs font-mono text-neutral-400">
                {dayCount} day{dayCount !== 1 ? 's' : ''}
                {dayCount >= 7 ? ` (${Math.floor(dayCount / 7)}w ${dayCount % 7}d)` : ''}
              </p>
            )}
          </div>

          {/* Pricing breakdown */}
          {pricing && (
            <div className="border border-white/10 bg-[#0A0A0B] p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                Pricing
              </p>

              {pricing.items.map((pi) => (
                <div key={pi.rental_id} className="flex justify-between text-xs font-mono">
                  <span className="text-neutral-400 truncate mr-2">
                    {pi.title} {pi.quantity > 1 ? `x${pi.quantity}` : ''}
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
            disabled={!dateRange.start || !dateRange.end || items.length === 0}
            className="w-full"
            size="lg"
          >
            {pricing
              ? `Checkout — R ${pricing.grandTotal.toLocaleString()}`
              : 'Select Dates to Checkout'}
          </Button>

          <p className="text-[9px] font-mono text-neutral-600 text-center">
            All items share the same rental period. Deposits are refundable.
          </p>
        </div>
      </div>
    </div>
  );
}
