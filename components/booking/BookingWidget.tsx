'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  Clock,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useCart } from '@/providers/CartProvider';
import { createClient } from '@/lib/supabase/client';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { calculateItemPrice, depositPerUnit } from '@/lib/cart/pricing';
import { STUDIO } from '@/lib/constants';
import { earliestBookableDate, leadTimeMessage } from '@/lib/rental/leadTime';
import { toLocalYmd, fromLocalYmd } from '@/lib/rental/dates';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';
import { formatRand } from '@/lib/format/money';
import { usePaymentsOpen } from '@/lib/payments/usePaymentsOpen';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';

interface Props {
  rental: SmartRental;
  /** onlinePaymentsOpen() from the server; when absent it is fetched. */
  paymentsOpen?: boolean;
}

type Verification = 'unverified' | 'pending' | 'verified' | 'rejected' | null;

/**
 * Pick dates, see the price, book.
 *
 * Everyone sees the dates, availability and the full price first, signed in or
 * not. The account and the ID check come only when someone presses to book,
 * and the chosen dates travel with them (?start=&end= in the address) through
 * sign-in and the ID check, so nobody has to choose them twice.
 */
export function BookingWidget(props: Props) {
  return (
    <Suspense fallback={<div className="h-12" />}>
      <BookingWidgetInner {...props} />
    </Suspense>
  );
}

function BookingWidgetInner({ rental, paymentsOpen: paymentsOpenProp }: Props) {
  const paymentsOpen = usePaymentsOpen(paymentsOpenProp);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { addToCart, loading: cartLoading } = useCart();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification>(null);

  // Dates carried in the address survive sign-in and the ID check.
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    start: fromLocalYmd(searchParams.get('start')),
    end: fromLocalYmd(searchParams.get('end')),
  }));
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
  // will refuse.
  const firstBookable = useMemo(() => earliestBookableDate(new Date()), []);
  const noticeMessage = useMemo(() => leadTimeMessage(new Date()), []);

  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + STUDIO.rental.maxBookingDays);
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

  // Same deposit rule the cart and checkout charge (25% of replacement value, RENTAL_POLICY).
  const depositAmount = depositPerUnit(rental as { deposit_amount?: number | null; replacement_value?: number | null });
  const startStr = dateRange.start ? toLocalYmd(dateRange.start) : null;
  const endStr = dateRange.end ? toLocalYmd(dateRange.end) : null;

  // This page with the chosen dates, for sign-in and the ID check to return to.
  const here = useMemo(() => {
    if (!startStr || !endStr) return pathname;
    return `${pathname}?start=${startStr}&end=${endStr}`;
  }, [pathname, startStr, endStr]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    createClient()
      .from('profiles')
      .select('verification_status')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (active) setVerification((data?.verification_status as Verification) ?? 'unverified');
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!startStr || !endStr) return;

    const controller = new AbortController();
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
  }, [startStr, endStr, rental.id]);

  const onDatesChange = (range: DateRange) => {
    setDateRange(range);
    setAdded(false);
    setError(null);
    setAvailability(null);
    const complete = range.start && range.end;
    setCheckingAvailability(!!complete);
    // Keep the dates in the address so they survive sign-in and the ID check.
    const next = complete ? `${pathname}?start=${toLocalYmd(range.start!)}&end=${toLocalYmd(range.end!)}` : pathname;
    router.replace(next, { scroll: false });
  };

  // One way to book gear: the item goes into the cart with its dates, and the
  // cart is the checkout (collection or delivery, pay in full or deposit now).
  // There used to be a second path from this page with different payment
  // rules, which the Terms had to explain twice.
  const handleBookNow = async () => {
    if (!startStr || !endStr) return;
    setError(null);
    setBooking(true);
    const ok = await addToCart(rental.id, 1, startStr, endStr);
    if (ok) {
      router.push('/dashboard/cart');
    } else {
      setError('Could not reserve it. It may be fully booked, or your cart is full.');
      setBooking(false);
    }
  };

  const handleAddToCart = async () => {
    setError(null);
    const ok = await addToCart(rental.id, 1, startStr ?? undefined, endStr ?? undefined);
    if (ok) {
      setAdded(true);
    } else {
      setError('Failed to add to cart. It may be full or unavailable.');
    }
  };

  const datesReady = days > 0 && !!availability?.available && !checkingAvailability;
  const canBook = datesReady && !booking;

  if (!rental.is_available) {
    return (
      <div className="border border-dashed border-white/10 p-6 text-center">
        <p className="text-sm text-neutral-400 font-mono">
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
          <span className="text-neutral-400 font-mono">Daily rate</span>
          <span className="font-mono font-bold text-white">
            {formatRand(rental.price_per_day ?? 0)} a day
          </span>
        </div>
        {rental.price_per_week && (
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400 font-mono">Weekly rate</span>
            <span className="font-mono font-bold text-white">
              {formatRand(rental.price_per_week)} a week
            </span>
          </div>
        )}
        {depositAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400 font-mono">Refundable deposit</span>
            <span className="font-mono text-neutral-400">
              {formatRand(depositAmount)}
            </span>
          </div>
        )}
      </div>

      {error && <p className="text-xs font-mono text-red-400">{error}</p>}

      {/* Dates, availability and price: for everyone */}
      <div className="space-y-4">
        <DateRangePicker
          value={dateRange}
          onChange={onDatesChange}
          minDate={firstBookable}
          maxDate={maxDate}
          label="Rental dates"
        />

        <p className="text-xs font-mono text-neutral-400 leading-relaxed">
          {noticeMessage}
        </p>

        {checkingAvailability && (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" />
            <p className="text-xs font-mono text-neutral-400">
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
            <p className="text-xs font-mono">
              {availability.available
                ? 'Available for selected dates'
                : 'Not available for selected dates'}
            </p>
          </div>
        )}

        {/* The price, exactly as it will be charged */}
        {datesReady && (
          <div className="border border-white/10 p-4 space-y-2 bg-[#0A0A0B]">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400 font-mono">
                {days} day{days !== 1 ? 's' : ''} rental
              </span>
              <span className="font-mono text-white">
                {formatRand(rentalPrice)}
              </span>
            </div>
            {depositAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400 font-mono">Refundable deposit</span>
                <span className="font-mono text-neutral-400">
                  {formatRand(depositAmount)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-white/5 pt-2">
              <span className="text-neutral-400 font-mono font-bold">Total with deposit</span>
              <span className="font-mono font-bold text-[#D4A843]">
                {formatRand(rentalPrice + depositAmount)}
              </span>
            </div>
            <p className="text-xs font-mono text-neutral-400">
              {paymentsOpen === false
                ? 'At checkout: collect it, or after your first hire have it delivered. Pay by EFT, or in cash when you collect.'
                : STUDIO.fulfilment.collection.allowBalanceOnCollection
                  ? 'At checkout: collect it, or after your first hire have it delivered, and pay everything now or only the deposit now and the rest when you collect.'
                  : 'At checkout: collect it, or after your first hire have it delivered. The hire and the refundable deposit are paid together.'}
            </p>
          </div>
        )}
      </div>

      {/* One next step, depending on where the person is */}
      {authLoading || (isLoggedIn && verification === null) ? (
        <div className="h-12" />
      ) : !isLoggedIn ? (
        <div className="space-y-3">
          <Link
            href={`/login?redirect=${encodeURIComponent(here)}`}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all min-h-[44px]"
          >
            <LogIn className="w-4 h-4" />
            {datesReady ? `Book these dates: ${formatRand(rentalPrice)}` : 'Book these dates'}
          </Link>
          <p className="text-xs font-mono text-neutral-400 text-center">
            {datesReady ? 'You sign in next. Your dates are kept.' : 'Choose your dates above to see the price.'}
          </p>
          <p className="text-xs font-mono text-neutral-400 text-center">
            First time? We check your ID once, and you collect the gear in person.
          </p>
        </div>
      ) : verification === 'pending' ? (
        <div className="border border-[#D4A843]/20 bg-[#D4A843]/5 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#D4A843]" />
            <p className="text-sm font-mono font-bold text-white">Your ID check is being reviewed</p>
          </div>
          <p className="text-xs font-mono text-neutral-400">
            You can book as soon as it is approved. Your dates are kept on this page.
          </p>
        </div>
      ) : verification !== 'verified' ? (
        <div className="space-y-3">
          <Link
            href={`/dashboard/verification?redirect=${encodeURIComponent(here)}`}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all min-h-[44px]"
          >
            <ShieldCheck className="w-4 h-4" />
            Check my ID to book
          </Link>
          <p className="text-xs font-mono text-neutral-400 text-center">
            {verification === 'rejected'
              ? 'Your last ID check was not approved. You can try again.'
              : 'A one-time check before your first rental. Your dates are kept.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={handleBookNow}
            disabled={!canBook}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-all min-h-[44px]"
          >
            {booking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : datesReady ? (
              `Book for ${formatRand(rentalPrice)}`
            ) : (
              'Choose your dates'
            )}
          </button>

          {added ? (
            <Link
              href="/dashboard/cart"
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              Added — View Cart
            </Link>
          ) : (
            <button
              onClick={handleAddToCart}
              disabled={cartLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-white/10 text-neutral-400 text-xs font-mono uppercase tracking-widest hover:text-white hover:border-white/20 disabled:opacity-50 transition-all"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              {cartLoading ? 'Adding...' : 'Add to cart and keep browsing'}
            </button>
          )}
        </div>
      )}

      {/* Say how payment works before anyone presses to book. Disappears by
          itself once online payment opens (onlinePaymentsOpen). */}
      <PaymentsNotOpenNote open={paymentsOpen} />

      {/* Info line */}
      <div className="flex items-start gap-2 text-xs font-mono text-neutral-400">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Renting 3 or more items? Add them to your cart for a bulk discount.
        </span>
      </div>
    </motion.div>
  );
}
