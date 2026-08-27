'use client';

import { useEffect, useState, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ShoppingCart,
  LogIn,
  Check,
  Info,
  ShieldCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useCart } from '@/providers/CartProvider';
import { createClient } from '@/lib/supabase/client';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { calculateItemPrice } from '@/lib/cart/pricing';
import { STUDIO } from '@/lib/constants';
import { earliestBookableDate, leadTimeMessage } from '@/lib/rental/leadTime';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';

interface Props {
  rental: SmartRental;
}

const VERIFICATION_PERKS = [
  'Rent professional equipment',
  'Supply your own gear as a verified supplier',
  'Accept gigs and get paid on completion',
  'Priority support',
];

export function BookingWidget({ rental }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToCart, loading: cartLoading } = useCart();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null });
  const [availability, setAvailability] = useState<{
    available: boolean;
    booked_count: number;
    total_quantity: number;
  } | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [booking, setBooking] = useState(false);

  const isLoggedIn = !!user;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // The first day a hire may actually start. Read from the same function the
  // checkout API validates with, so the picker cannot offer a date the server
  // will refuse — being told no after filling in the whole form is the worst
  // way to learn a rule.
  const firstBookable = useMemo(() => earliestBookableDate(new Date()), []);
  const noticeMessage = useMemo(() => leadTimeMessage(new Date()), []);

  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + STUDIO.rental.maxDirectBookingDays);
    return d;
  }, [today]);

  const days = useMemo(() => {
    if (!dateRange.start || !dateRange.end) return 0;
    return Math.ceil(
      (dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24),
    );
  }, [dateRange]);

  const rentalPrice = useMemo(() => {
    if (days <= 0) return 0;
    return calculateItemPrice(rental.price_per_day ?? 0, rental.price_per_week ?? null, days);
  }, [days, rental.price_per_day, rental.price_per_week]);

  const depositAmount = rental.deposit_amount ?? 0;
  const totalPrice = rentalPrice + depositAmount;

  useEffect(() => {
    if (!user) {
      setVerified(null);
      return;
    }
    const supabase = createClient();
    supabase
      .from('profiles')
      .select('verification_status')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setVerified(data?.verification_status === 'verified');
      });
  }, [user]);

  useEffect(() => {
    if (!dateRange.start || !dateRange.end) {
      setAvailability(null);
      return;
    }

    const controller = new AbortController();
    setCheckingAvailability(true);
    setAvailability(null);

    const startStr = dateRange.start.toISOString().split('T')[0];
    const endStr = dateRange.end.toISOString().split('T')[0];

    fetch(
      `/api/rentals/${rental.id}/availability?start_date=${startStr}&end_date=${endStr}`,
      { signal: controller.signal },
    )
      .then((res) => res.json())
      .then((data) => {
        setAvailability(data);
        setCheckingAvailability(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setCheckingAvailability(false);
        }
      });

    return () => controller.abort();
  }, [dateRange, rental.id]);

  const handleBookNow = async () => {
    if (!dateRange.start || !dateRange.end) return;
    setError(null);
    setBooking(true);

    try {
      const startStr = dateRange.start.toISOString().split('T')[0];
      const endStr = dateRange.end.toISOString().split('T')[0];

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rental_id: rental.id,
          start_date: startStr,
          end_date: endStr,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Booking failed.');
      }

      if (data.payment_url) {
        window.location.href = data.payment_url;
      } else {
        router.push(`/dashboard/bookings/${data.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed.');
      setBooking(false);
    }
  };

  const handleAddToCart = async () => {
    setError(null);
    const ok = await addToCart(rental.id);
    if (ok) {
      setAdded(true);
    } else {
      setError('Failed to add to cart. It may be full or unavailable.');
    }
  };

  const canBook =
    days > 0 && availability?.available && !booking && !checkingAvailability;

  if (!rental.is_available) {
    return (
      <div className="border border-dashed border-white/10 p-6 text-center">
        <p className="text-sm text-neutral-500 font-mono">
          This item is currently unavailable.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Rate card */}
      <div className="border border-white/10 p-4 space-y-2 bg-[#0A0A0B]">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500 font-mono">Daily rate</span>
          <span className="font-mono font-bold text-white">
            {rental.currency} {(rental.price_per_day ?? 0).toLocaleString()}/day
          </span>
        </div>
        {rental.price_per_week && (
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500 font-mono">Weekly rate</span>
            <span className="font-mono font-bold text-white">
              {rental.currency} {rental.price_per_week.toLocaleString()}/week
            </span>
          </div>
        )}
      </div>

      {error && <p className="text-[10px] font-mono text-red-400">{error}</p>}

      {/* Auth gates */}
      {authLoading || (isLoggedIn && verified === null) ? (
        <div className="h-12" />
      ) : !isLoggedIn ? (
        <div className="space-y-3">
          <Link
            href={`/login?redirect=${encodeURIComponent(pathname)}`}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all"
          >
            <LogIn className="w-4 h-4" />
            Sign In to Rent
          </Link>
          <p className="text-[9px] font-mono text-neutral-500 text-center">
            Sign in to book equipment or add to cart
          </p>
        </div>
      ) : !verified ? (
        <div className="border border-[#D4A843]/20 bg-[#D4A843]/5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#D4A843]" />
            <p className="text-sm font-mono font-bold text-white">Get Verified</p>
          </div>
          <p className="text-[10px] font-mono text-neutral-400">
            Verify your identity to unlock the full platform:
          </p>
          <ul className="space-y-2">
            {VERIFICATION_PERKS.map((perk) => (
              <li
                key={perk}
                className="flex items-start gap-2 text-[10px] font-mono text-neutral-300"
              >
                <Check className="w-3 h-3 mt-0.5 text-[#D4A843] flex-shrink-0" />
                {perk}
              </li>
            ))}
          </ul>
          <Link
            href="/dashboard/verification"
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all"
          >
            <ShieldCheck className="w-4 h-4" />
            Verify Now
          </Link>
        </div>
      ) : (
        /* ─── Verified user: booking form ─── */
        <div className="space-y-4">
          <DateRangePicker
            value={dateRange}
            onChange={(range) => {
              setDateRange(range);
              setAdded(false);
              setError(null);
            }}
            minDate={firstBookable}
            maxDate={maxDate}
            label="Rental dates"
          />

          <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
            {noticeMessage}
          </p>

          {/* Availability indicator */}
          {checkingAvailability && (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" />
              <p className="text-[10px] font-mono text-neutral-400">
                Checking availability...
              </p>
            </div>
          )}

          {availability && !checkingAvailability && (
            <div
              className={`flex items-center gap-2 ${availability.available ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {availability.available ? (
                <Check className="w-3 h-3" />
              ) : (
                <AlertCircle className="w-3 h-3" />
              )}
              <p className="text-[10px] font-mono">
                {availability.available
                  ? 'Available for selected dates'
                  : 'Not available for selected dates'}
              </p>
            </div>
          )}

          {/* Price breakdown */}
          {days > 0 && availability?.available && (
            <div className="border border-white/10 p-4 space-y-2 bg-[#0A0A0B]">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500 font-mono">
                  {days} day{days !== 1 ? 's' : ''} rental
                </span>
                <span className="font-mono text-white">
                  {rental.currency} {rentalPrice.toLocaleString()}
                </span>
              </div>
              {depositAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500 font-mono">Refundable deposit</span>
                  <span className="font-mono text-neutral-400">
                    {rental.currency} {depositAmount.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t border-white/5 pt-2">
                <span className="text-neutral-500 font-mono font-bold">Total</span>
                <span className="font-mono font-bold text-[#D4A843]">
                  {rental.currency} {totalPrice.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Book Now */}
          <button
            onClick={handleBookNow}
            disabled={!canBook}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-all min-h-[44px]"
          >
            {booking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Book Now'
            )}
          </button>

          {/* Add to Cart (secondary) */}
          {added ? (
            <Link
              href="/dashboard/cart"
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              Added — View Cart
            </Link>
          ) : (
            <button
              onClick={handleAddToCart}
              disabled={cartLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-white/10 text-neutral-400 text-[10px] font-mono uppercase tracking-widest hover:text-white hover:border-white/20 disabled:opacity-50 transition-all"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              {cartLoading ? 'Adding...' : 'Or Add to Cart'}
            </button>
          )}
        </div>
      )}

      {/* Info line */}
      <div className="flex items-start gap-2 text-[9px] font-mono text-neutral-600">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Book now for instant checkout, or add to cart for bulk discounts on 3+ items.
        </span>
      </div>
    </motion.div>
  );
}
