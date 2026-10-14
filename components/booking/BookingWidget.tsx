'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Circle,
  RotateCw,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useCart } from '@/providers/CartProvider';
import { createClient } from '@/lib/supabase/client';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { calculateItemPrice, depositPerUnit } from '@/lib/cart/pricing';
import { ON_SITE_RENTAL, RENTAL_POLICY, STUDIO } from '@/lib/constants';
import { halfDayPrice, isOnSiteCategory } from '@/lib/rental/on-site';
import { collectionPointWithCity } from '@/lib/rental/collection-point';
import { whatsappLink } from '@/lib/payments/eft';
import { earliestBookableDate, leadTimeMessage } from '@/lib/rental/leadTime';
import { toLocalYmd, fromLocalYmd, checkHireRange } from '@/lib/rental/dates';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';
import type { ReadinessItem, RentalReadiness } from '@/lib/rental/eligibility-server';
import { formatRand } from '@/lib/format/money';
import { itemValue } from '@/lib/rental/protection';
import { usePaymentsOpen } from '@/lib/payments/usePaymentsOpen';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';
import { reportFunnel } from '@/lib/analytics/client';

interface Props {
  rental: SmartRental;
  /** onlinePaymentsOpen() from the server; when absent it is fetched. */
  paymentsOpen?: boolean;
}

type Verification = 'unverified' | 'pending' | 'verified' | 'rejected' | null;

const centsToRand = (cents: number): string => formatRand(Math.round(cents / 100));

/**
 * What a renter still needs before paying, from GET /api/rentals/eligibility
 * (the same rules the checkout enforces). `query` is the endpoint's query
 * string, or null to skip (signed out). Refreshes when the window regains
 * focus, so a step finished in another tab shows straight away.
 */
export function useRenterReadiness(query: string | null): {
  readiness: RentalReadiness | null;
  failed: boolean;
  reload: () => void;
} {
  const [readiness, setReadiness] = useState<RentalReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    fetch(`/api/rentals/eligibility${query ? `?${query}` : ''}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setReadiness((await res.json()) as RentalReadiness);
        setFailed(false);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [query, tick]);

  useEffect(() => {
    if (query === null) return;
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [query, reload]);

  return { readiness, failed, reload };
}

/** A fix link that returns to `back` where the page supports it. */
function fixHref(item: ReadinessItem, back: string | null): string | null {
  if (!item.href) return null;
  if (back && item.href === '/dashboard/verification') return `${item.href}?redirect=${encodeURIComponent(back)}`;
  return item.href;
}

/**
 * The renter's checklist: every requirement for this order, done or not, each
 * with where to fix it. Shown before payment on the gear page and the cart.
 */
export function RenterChecklist({
  readiness,
  back,
  title = 'Before you pay',
}: {
  readiness: RentalReadiness;
  /** The page to come back to after a step, where supported. */
  back: string | null;
  title?: string;
}) {
  return (
    <section aria-label={title} className="border border-white/10 bg-[#0A0A0B] p-4 space-y-3">
      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">{title}</p>
      <ul className="space-y-2">
        {readiness.checklist.map((item) => {
          const href = fixHref(item, back);
          return (
            <li key={item.code} className="flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
                {item.status === 'done' ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : item.status === 'pending' ? (
                  <Clock className="w-4 h-4 text-[#D4A843]" />
                ) : item.status === 'unavailable' ? (
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                ) : (
                  <Circle className="w-4 h-4 text-neutral-400" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-mono ${item.status === 'done' ? 'text-neutral-400' : 'text-white'}`}>
                  <span className="sr-only">
                    {item.status === 'done' ? 'Done: ' : item.status === 'pending' ? 'Waiting: ' : item.status === 'unavailable' ? 'Not available yet: ' : 'To do: '}
                  </span>
                  {item.label}
                </p>
                {item.detail && <p className="text-xs font-mono text-neutral-400 mt-0.5">{item.detail}</p>}
                {item.code === 'verify_phone' && item.status === 'unavailable' && (
                  <p className="text-xs font-mono text-neutral-400 mt-0.5">
                    WhatsApp {STUDIO.whatsapp.display} or email {STUDIO.email}.
                  </p>
                )}
                {href && (
                  <Link
                    href={href}
                    className="inline-flex items-center min-h-[44px] text-xs font-mono uppercase tracking-widest text-[#D4A843] underline underline-offset-4"
                  >
                    {item.status === 'unavailable' || item.code === 'trust_limit' || item.code === 'account_hold'
                      ? 'Contact us'
                      : item.status === 'pending'
                        ? 'See your ID check'
                        : 'Do this now'}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {readiness.requiresManualApproval && (
        <p className="text-xs font-mono text-neutral-400">A person approves this booking before the gear is handed over.</p>
      )}
    </section>
  );
}

/** The gear page with its dates (when both are set) and quantity (when more than one). */
export function pageHref(pathname: string, start: string | null, end: string | null, quantity: number): string {
  const q = new URLSearchParams();
  if (start && end) {
    q.set('start', start);
    q.set('end', end);
  }
  if (quantity > 1) q.set('qty', String(quantity));
  const qs = q.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** What renting needs, from the policy, for someone not signed in. */
function SignedOutSummary({ highValue }: { highValue: boolean }) {
  const limits = RENTAL_POLICY.trustTierLimitsCents;
  return (
    <section aria-label="What you need to rent" className="border border-white/10 bg-[#0A0A0B] p-4 space-y-2">
      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">What you need to rent</p>
      <ul className="space-y-1.5 text-xs font-mono text-neutral-300 list-disc pl-4">
        <li>An account with a confirmed email address and phone number.</li>
        <li>A one-time ID check (ID and selfie), approved by a person before you pay.</li>
        <li>
          Up to {centsToRand(limits.contactable)} of gear at a time to start, {centsToRand(limits.verified)} with a bank
          account in your own name. It rises after on-time returns.
        </li>
        {RENTAL_POLICY.firstHireCollectionOnly && <li>Your first hire is collected in person.</li>}
        {highValue && (
          <li>Items worth more than {centsToRand(RENTAL_POLICY.highValueCollectionThresholdCents)} are always collected in person.</li>
        )}
      </ul>
    </section>
  );
}

/**
 * Pick dates, see the price and what you need, book.
 *
 * Everyone sees the dates, availability, the full price and what renting
 * needs first, signed in or not. The chosen dates travel in the address
 * (?start=&end=) through sign-in and the checks, so nobody chooses them
 * twice. Nothing here can let anyone pay without the checks: the checkout
 * re-checks everything.
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
  // The cart's "Edit dates" link keeps the quantity it had. Read once from
  // the address and kept here: the address is rewritten while dates are
  // picked, and a quantity read from it again could fall back to 1.
  const [quantity] = useState<number>(() => {
    const q = Number(searchParams.get('qty') ?? '1');
    return Number.isInteger(q) && q >= 1 && q <= STUDIO.rental.maxQuantityPerItem ? q : 1;
  });
  const [availability, setAvailability] = useState<{
    available: boolean;
    booked_count: number;
    total_quantity: number;
  } | null>(null);
  const [availabilityFailed, setAvailabilityFailed] = useState(false);
  const [availabilityTick, setAvailabilityTick] = useState(0);
  const [checkingAvailability, setCheckingAvailability] = useState(
    () =>
      checkHireRange(
        fromLocalYmd(searchParams.get('start')),
        fromLocalYmd(searchParams.get('end')),
        STUDIO.rental.maxBookingDays,
        earliestBookableDate(new Date()),
      ).ok,
  );
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

  // One date rule with the cart and checkout: return after pick-up, at most
  // maxBookingDays, and not before the first bookable day. Dates can arrive
  // in the address (an older cart item, a shared link), not only from the picker.
  const rangeCheck = useMemo(
    () => checkHireRange(dateRange.start, dateRange.end, STUDIO.rental.maxBookingDays, firstBookable),
    [dateRange, firstBookable],
  );
  const days = rangeCheck.ok ? rangeCheck.days : 0;

  const rentalPrice = useMemo(() => {
    if (days <= 0) return 0;
    return calculateItemPrice(rental.price_per_day ?? 0, rental.price_per_week ?? null, days) * quantity;
  }, [days, rental.price_per_day, rental.price_per_week, quantity]);

  // Same deposit rule the cart and checkout charge (25% of replacement value, RENTAL_POLICY).
  const depositAmount = depositPerUnit(rental as { deposit_amount?: number | null; replacement_value?: number | null }) * quantity;
  const startStr = rangeCheck.ok && dateRange.start ? toLocalYmd(dateRange.start) : null;
  const endStr = rangeCheck.ok && dateRange.end ? toLocalYmd(dateRange.end) : null;
  // Valued as the checkout values it (lib/rental/protection itemValue).
  const highValue =
    Math.round(itemValue(rental as { replacement_value?: number | null; deposit_amount?: number | null }) * 100) >
    RENTAL_POLICY.highValueCollectionThresholdCents;

  // A place (the Studios category): booked by the full day and used where it
  // is; a half day is arranged on WhatsApp (bookings are whole days).
  const place = isOnSiteCategory(rental.category);
  const halfDay = halfDayPrice(rental);

  // This page with the chosen dates and quantity, for sign-in and the checks to return to.
  const here = useMemo(() => pageHref(pathname, startStr, endStr, quantity), [pathname, startStr, endStr, quantity]);

  // Funnel (spec §9.6): ids and a day count only.
  useEffect(() => {
    reportFunnel('rental_viewed', { rentalId: rental.id, surface: 'gear_page' });
  }, [rental.id]);
  const reportedRange = useRef<string | null>(null);
  useEffect(() => {
    if (!startStr || !endStr) return;
    const key = `${startStr}:${endStr}`;
    if (reportedRange.current === key) return;
    reportedRange.current = key;
    reportFunnel('dates_chosen', { rentalId: rental.id, days, surface: 'gear_page' });
  }, [startStr, endStr, days, rental.id]);

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

  // The renter's checklist for this item and these dates.
  const readinessQuery = useMemo(() => {
    if (!user) return null;
    const q = new URLSearchParams({ rental_id: rental.id, quantity: String(quantity) });
    if (startStr && endStr) {
      q.set('start', startStr);
      q.set('end', endStr);
    }
    return q.toString();
  }, [user, rental.id, quantity, startStr, endStr]);
  const { readiness, failed: readinessFailed } = useRenterReadiness(readinessQuery);

  useEffect(() => {
    if (!startStr || !endStr) return;

    const controller = new AbortController();
    fetch(
      `/api/rentals/${rental.id}/availability?start_date=${startStr}&end_date=${endStr}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (typeof data?.available !== 'boolean') throw new Error('bad response');
        setAvailability(data);
        setAvailabilityFailed(false);
        setCheckingAvailability(false);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          setAvailabilityFailed(true);
          setCheckingAvailability(false);
        }
      });

    return () => controller.abort();
  }, [startStr, endStr, rental.id, availabilityTick]);

  const retryAvailability = () => {
    setAvailabilityFailed(false);
    setCheckingAvailability(true);
    setAvailabilityTick((t) => t + 1);
  };

  const onDatesChange = (range: DateRange) => {
    setDateRange(range);
    setAdded(false);
    setError(null);
    setAvailability(null);
    setAvailabilityFailed(false);
    const valid = checkHireRange(range.start, range.end, STUDIO.rental.maxBookingDays, firstBookable).ok;
    setCheckingAvailability(valid);
    // Keep the dates and the quantity in the address so they survive sign-in
    // and the ID check. The quantity stays even while the range is incomplete.
    const next = valid
      ? pageHref(pathname, toLocalYmd(range.start!), toLocalYmd(range.end!), quantity)
      : pageHref(pathname, null, null, quantity);
    router.replace(next, { scroll: false });
  };

  // One way to book gear: the item goes into the cart with its dates, and the
  // cart is the checkout (collection or delivery, pay in full or deposit now).
  const handleBookNow = async () => {
    if (!startStr || !endStr) return;
    setError(null);
    setBooking(true);
    const ok = await addToCart(rental.id, quantity, startStr, endStr);
    if (ok) {
      router.push('/dashboard/cart');
    } else {
      setError('Could not add it to your cart. It may be fully booked, or your cart is full.');
      setBooking(false);
    }
  };

  // Dates are required: the cart does not ask for them again.
  const handleAddToCart = async () => {
    if (!startStr || !endStr) {
      setError('Choose your dates first.');
      return;
    }
    setError(null);
    const ok = await addToCart(rental.id, quantity, startStr, endStr);
    if (ok) {
      setAdded(true);
    } else {
      setError('Could not add it to your cart. It may be full or unavailable.');
    }
  };

  // Enough units for the quantity asked for (an "Edit dates" line can carry
  // more than one), not merely one free unit: checkout checks the quantity.
  const unitsFree = availability ? Math.max(0, availability.total_quantity - availability.booked_count) : 0;
  const enoughUnits = !!availability?.available && unitsFree >= quantity;
  const datesReady = days > 0 && enoughUnits && !checkingAvailability;
  const canBook = datesReady && !booking;
  const rangeHint =
    !rangeCheck.ok && rangeCheck.problem !== 'incomplete'
      ? rangeCheck.message
      : dateRange.start && !dateRange.end
        ? place
          ? 'Now choose the day after your last studio day. One full day: your day, then the next.'
          : 'Now choose the return day. A one-day hire is returned the next day.'
        : undefined;

  // Whether this renter may pay now. The checklist decides when it loaded;
  // otherwise the ID check alone (the checkout still checks everything).
  const idItem = readiness?.checklist.find((c) => c.code === 'verify_id');
  const idPending = idItem ? idItem.status === 'pending' : verification === 'pending';
  const canPay = readiness ? readiness.ok : verification === 'verified';
  const firstFix = readiness?.missing.find((m) => m.href && m.status === 'missing') ?? null;

  if (!rental.is_available) {
    return (
      <div className="border border-dashed border-white/10 p-6 text-center">
        <p className="text-sm text-neutral-400 font-mono">
          This item is currently unavailable.
        </p>
      </div>
    );
  }

  const addToCartButton = added ? (
    <Link
      href="/dashboard/cart"
      className="w-full flex items-center justify-center gap-2 min-h-[44px] py-2.5 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all"
    >
      <Check className="w-3.5 h-3.5" aria-hidden="true" />
      Added — View Cart
    </Link>
  ) : (
    <button
      type="button"
      onClick={handleAddToCart}
      disabled={cartLoading || !datesReady}
      className="w-full flex items-center justify-center gap-2 min-h-[44px] py-2.5 border border-white/10 text-neutral-400 text-xs font-mono uppercase tracking-widest hover:text-white hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
    >
      <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
      {cartLoading
        ? 'Adding...'
        : !datesReady
          ? 'Choose dates to add to cart'
          : canPay
            ? 'Add to cart and keep browsing'
            : 'Save to cart for later'}
    </button>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
      data-testid="booking-widget"
    >
      {/* Rate card */}
      <div className="border border-white/10 p-4 space-y-2 bg-[#0A0A0B]">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-400 font-mono">{place ? ON_SITE_RENTAL.fullDayLabel : 'Daily rate'}</span>
          <span className="font-mono font-bold text-white">
            {formatRand(rental.price_per_day ?? 0)}{place ? '' : ' a day'}
          </span>
        </div>
        {halfDay != null && (
          <div className="flex justify-between items-center gap-3 text-sm">
            <span className="text-neutral-400 font-mono">{ON_SITE_RENTAL.halfDayLabel}</span>
            <span className="font-mono text-white">
              {formatRand(halfDay)}:{' '}
              <a
                href={whatsappLink(ON_SITE_RENTAL.halfDayMessage(rental.title))}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center text-[#D4A843] underline underline-offset-4"
                data-testid="half-day-ask"
              >
                {ON_SITE_RENTAL.halfDayAsk}
              </a>
            </span>
          </div>
        )}
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

      {error && (
        <p role="alert" className="text-xs font-mono text-red-400">
          {error}
        </p>
      )}

      {/* Dates, availability and price: for everyone */}
      <div className="space-y-4">
        <DateRangePicker
          value={dateRange}
          onChange={onDatesChange}
          minDate={firstBookable}
          maxDate={maxDate}
          minNights={1}
          maxNights={STUDIO.rental.maxBookingDays}
          label={place ? 'Studio dates' : 'Rental dates'}
          hint={rangeHint}
        />

        <p className="text-xs font-mono text-neutral-400 leading-relaxed">
          {noticeMessage}{' '}
          {place
            ? 'Full days only online: choose your studio day, then the next day (two days: your first day, then the day after the last).'
            : 'Pick up on the first day, return on the last.'}
        </p>

        {checkingAvailability && (
          <div className="flex items-center gap-2" role="status">
            <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" aria-hidden="true" />
            <p className="text-xs font-mono text-neutral-400">
              Checking availability...
            </p>
          </div>
        )}

        {availabilityFailed && !checkingAvailability && (
          <div role="alert" className="flex items-center justify-between gap-2 text-amber-400">
            <p className="text-xs font-mono flex items-center gap-2">
              <AlertCircle className="w-3 h-3" aria-hidden="true" />
              Could not check availability just now.
            </p>
            <button
              type="button"
              onClick={retryAvailability}
              className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[#D4A843]"
            >
              <RotateCw className="w-3 h-3" aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {availability && !checkingAvailability && (
          <div
            role="status"
            className={`flex items-center gap-2 ${enoughUnits ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {enoughUnits ? (
              <Check className="w-3 h-3" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-3 h-3" aria-hidden="true" />
            )}
            <p className="text-xs font-mono">
              {enoughUnits
                ? 'Available for selected dates'
                : availability.available && quantity > 1
                  ? `Only ${unitsFree} of the ${quantity} you asked for ${unitsFree === 1 ? 'is' : 'are'} free on these dates. Try other dates or a smaller quantity.`
                  : 'Not available for selected dates. Try other dates.'}
            </p>
          </div>
        )}

        {/* The price, exactly as it will be charged */}
        {datesReady && (
          <div className="border border-white/10 p-4 space-y-2 bg-[#0A0A0B]">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400 font-mono">
                {days} {place ? 'full ' : ''}day{days !== 1 ? 's' : ''} {place ? 'in the studio' : 'rental'}{quantity > 1 ? ` x${quantity}` : ''}
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
              {place
                ? `Used at the studio in ${collectionPointWithCity()}. Nothing to collect or deliver.`
                : readiness?.collectionRequired
                ? readiness.collectionReasons.includes('high_value_item')
                  ? `You collect this in person: items worth more than ${centsToRand(RENTAL_POLICY.highValueCollectionThresholdCents)} always are.`
                  : 'You collect this in person: a first hire always is. Delivery opens after your first clean return.'
                : paymentsOpen === false
                  ? 'At checkout: collect it, or after your first hire have it delivered. Pay by EFT, or in cash when you collect.'
                  : STUDIO.fulfilment.collection.allowBalanceOnCollection
                    ? 'At checkout: collect it, or after your first hire have it delivered, and pay everything now or only the deposit now and the rest when you collect.'
                    : 'At checkout: collect it, or after your first hire have it delivered. The hire and the refundable deposit are paid together.'}
            </p>
          </div>
        )}
      </div>

      {/* One next step, depending on where the person is */}
      {authLoading || (isLoggedIn && verification === null && !readiness && !readinessFailed) ? (
        <div className="h-12" />
      ) : !isLoggedIn ? (
        <div className="space-y-3">
          <Link
            href={`/login?redirect=${encodeURIComponent(here)}`}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all min-h-[44px]"
          >
            <LogIn className="w-4 h-4" aria-hidden="true" />
            {datesReady ? `Book these dates: ${formatRand(rentalPrice)}` : 'Book these dates'}
          </Link>
          <p className="text-xs font-mono text-neutral-400 text-center">
            {datesReady ? 'You sign in next. Your dates are kept.' : 'Choose your dates above to see the price.'}
          </p>
          <SignedOutSummary highValue={highValue} />
        </div>
      ) : canPay ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleBookNow}
            disabled={!canBook}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-all min-h-[44px]"
          >
            {booking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Processing...
              </>
            ) : datesReady ? (
              `Book for ${formatRand(rentalPrice)}`
            ) : (
              'Choose your dates'
            )}
          </button>
          {addToCartButton}
          {readiness && readiness.requiresManualApproval && (
            <p className="text-xs font-mono text-neutral-400">A person approves this booking before the gear is handed over.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {idPending ? (
            <div className="border border-[#D4A843]/20 bg-[#D4A843]/5 p-5 space-y-2" role="status">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#D4A843]" aria-hidden="true" />
                <p className="text-sm font-mono font-bold text-white">Your ID check is being reviewed</p>
              </div>
              <p className="text-xs font-mono text-neutral-400">
                A person reviews it and we let you know. You can pay once it is approved. Meanwhile, finish the
                other steps below and save these dates to your cart; saving does not hold them for you.
              </p>
            </div>
          ) : verification !== 'verified' && (!idItem || idItem.status === 'missing') ? (
            <Link
              href={`/dashboard/verification?redirect=${encodeURIComponent(here)}`}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all min-h-[44px]"
            >
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              Check my ID to book
            </Link>
          ) : firstFix ? (
            <Link
              href={fixHref(firstFix, here) ?? '/contact'}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-all min-h-[44px]"
            >
              {firstFix.label}
            </Link>
          ) : null}
          {verification === 'rejected' && !idPending && (
            <p className="text-xs font-mono text-neutral-400 text-center">
              Your last ID check was not approved. You can try again.
            </p>
          )}
          {readiness ? (
            <RenterChecklist readiness={readiness} back={here} />
          ) : (
            <p className="text-xs font-mono text-neutral-400 text-center">
              A one-time check before your first rental. Your dates are kept.
            </p>
          )}
          {addToCartButton}
        </div>
      )}

      {/* Say how payment works before anyone presses to book. Disappears by
          itself once online payment opens (onlinePaymentsOpen). */}
      <PaymentsNotOpenNote open={paymentsOpen} />

      {/* Info line */}
      <div className="flex items-start gap-2 text-xs font-mono text-neutral-400">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>
          Renting 3 or more items? Add them to your cart for a bulk discount.
        </span>
      </div>
    </motion.div>
  );
}
