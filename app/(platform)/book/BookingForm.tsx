'use client';

import { useState, useMemo, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, Camera, Package } from 'lucide-react';
import { quoteHourly, quotePackage } from '@/lib/bookings/pricing';
import { getHourlyRate } from '@/lib/bookings/rates';
import { toLocalYmd } from '@/lib/rental/dates';
import { formatRand, withServiceVat } from '@/lib/format/money';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';

/** A studio package booked at its own price (see app/(platform)/book/page.tsx). */
export interface BookingPackage {
  id: string;
  title: string;
  price: number;
  unit: string;
  unitWords: string;
}

const DELIVERABLES = [
  'Edited Photos (Digital)',
  'Edited Video',
  'Photos + Video',
  'Raw Files',
  'Social Media Cuts',
  'All of the Above',
];

const CATEGORIES = [
  'Portrait Photography',
  'Wedding Photography',
  'Wedding Cinematography',
  'Corporate Photography',
  'Corporate Video',
  'Music Video',
  'Event Coverage',
  'Product Photography',
  'Real Estate Photography',
  'Content Creation',
  'Documentary',
  'Short Film',
];

interface BookingFormProps {
  creatorId: string | null;
  creatorName: string | null;
  /** Not used for the price: the server charges the shoot type's rate. */
  creatorRate: number | null;
  creatorSpecializations: string[];
  initialCategory: string;
  initialHours: number;
  initialLocation: string;
  initialDates: string;
  hourlyRate: number;
  minHours: number;
  maxHours: number;
  pkg?: BookingPackage | null;
  /** onlinePaymentsOpen() from the server. */
  paymentsOpen: boolean;
}

export function BookingForm({
  creatorId,
  creatorName,
  creatorSpecializations,
  initialCategory,
  initialHours,
  initialLocation,
  initialDates,
  hourlyRate: defaultRate,
  minHours,
  maxHours,
  pkg = null,
  paymentsOpen,
}: BookingFormProps) {
  const router = useRouter();
  // Every label is tied to its control (htmlFor/id), so tapping the label
  // focuses the field and a screen reader announces the field by name.
  const fieldId = useId();
  const ids = {
    category: `${fieldId}-category`,
    hours: `${fieldId}-hours`,
    hoursHint: `${fieldId}-hours-hint`,
    date: `${fieldId}-date`,
    location: `${fieldId}-location`,
    deliverables: `${fieldId}-deliverables`,
  };
  const [category, setCategory] = useState(initialCategory);
  const [hours, setHours] = useState(initialHours);
  const [date, setDate] = useState(initialDates);
  const [location, setLocation] = useState(initialLocation);
  const [deliverables, setDeliverables] = useState('');

  // The rate the server charges for the chosen shoot type (lib/bookings/rates),
  // so the quote here is the price on the next page and the price paid. No
  // price until a type is chosen: a quote of R0 is never shown.
  const rate = category ? getHourlyRate(category) : defaultRate > 0 ? defaultRate : 0;
  // A package priced per project/session/event needs no hours and no shoot type.
  const fixedPackage = !!pkg && pkg.unit !== 'hour';

  const quote = useMemo(() => {
    if (pkg) {
      if (!fixedPackage && (!hours || hours < minHours)) return null;
      return quotePackage(pkg.price, pkg.unit, hours);
    }
    if (!rate || !hours || hours < minHours) return null;
    return quoteHourly(rate, hours);
  }, [pkg, fixedPackage, rate, hours, minHours]);

  const canSubmit = pkg ? date && (fixedPackage || hours >= minHours) : category && hours >= minHours && date;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const params = new URLSearchParams({
      ...(pkg ? { production: pkg.id } : { category }),
      hours: String(hours),
      dates: date,
      ...(location && { location }),
      ...(deliverables && { deliverables }),
      ...(creatorId && { creator_id: creatorId }),
    });

    router.push(`/book?${params.toString()}`);
  }

  // Tomorrow as min date (the local day; toISOString() gave the UTC day)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = toLocalYmd(tomorrow);

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-20">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <h1 className="mb-2 text-2xl font-bold text-white">
          {pkg ? `Request: ${pkg.title}` : creatorName ? `Request ${creatorName}` : 'Request a Shoot'}
        </h1>
        {creatorName && creatorSpecializations.length > 0 && (
          <p className="mb-2 text-sm text-neutral-400">
            {creatorSpecializations.join(', ')}
          </p>
        )}
        {pkg ? (
          <p className="mb-8 text-[#D4A843] font-mono text-sm">
            {formatRand(withServiceVat(pkg.price))} {pkg.unitWords}
          </p>
        ) : rate > 0 && (
          <p className="mb-8 text-[#D4A843] font-mono text-sm">
            {formatRand(withServiceVat(rate))} an hour
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Category (a package already says what the shoot is) */}
          {!pkg && (
          <div>
            <label htmlFor={ids.category} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
              <Camera className="w-3.5 h-3.5" aria-hidden="true" />
              Type of shoot
            </label>
            <select
              id={ids.category}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-base md:text-sm font-mono px-4 py-3 min-h-[44px] focus:outline-none focus:border-[#D4A843]/50"
            >
              <option value="">Select...</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          )}

          {/* Hours (not asked for a fixed-price package) */}
          {!fixedPackage && (
          <div>
            <label htmlFor={ids.hours} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              How many hours?
            </label>
            <div className="flex items-center gap-3">
              <input
                id={ids.hours}
                aria-describedby={ids.hoursHint}
                type="number"
                inputMode="numeric"
                min={minHours}
                max={maxHours}
                value={hours}
                onChange={(e) => setHours(parseInt(e.target.value, 10) || minHours)}
                required
                className="w-24 bg-neutral-900 border border-neutral-800 text-white text-base md:text-sm font-mono px-4 py-3 min-h-[44px] text-center focus:outline-none focus:border-[#D4A843]/50"
              />
              <span id={ids.hoursHint} className="text-neutral-400 text-sm font-mono">
                hours (min {minHours})
              </span>
            </div>
          </div>

          )}

          {/* Date */}
          <div>
            <label htmlFor={ids.date} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
              <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
              When?
            </label>
            <input
              id={ids.date}
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-base md:text-sm font-mono px-4 py-3 min-h-[44px] focus:outline-none focus:border-[#D4A843]/50"
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor={ids.location} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              Where? <span className="text-neutral-400">(optional)</span>
            </label>
            <input
              id={ids.location}
              type="text"
              autoComplete="street-address"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Studio, venue, or city..."
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-base md:text-sm font-mono px-4 py-3 min-h-[44px] placeholder-neutral-400 focus:outline-none focus:border-[#D4A843]/50"
            />
          </div>

          {/* What they get.
              The API stopped hard-requiring this because neither route ever
              supplied it, but it is genuinely useful for the creator, so it is
              asked here rather than guessed later. Optional on purpose: it must
              never be the reason a booking does not happen. */}
          <div>
            <label htmlFor={ids.deliverables} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
              <Package className="w-3.5 h-3.5" aria-hidden="true" />
              What do you need back? <span className="text-neutral-400">(optional)</span>
            </label>
            <select
              id={ids.deliverables}
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 text-white text-base md:text-sm font-mono px-4 py-3 min-h-[44px] focus:outline-none focus:border-[#D4A843]/50"
            >
              <option value="">We can decide later...</option>
              {DELIVERABLES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Live quote */}
          {quote && (
            <div className="border border-neutral-800 bg-neutral-900/50 p-5 mt-6" aria-live="polite">
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
                Quote
              </p>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex justify-between text-neutral-400">
                  <span>{quote.line}</span>
                  <span>{formatRand(quote.total)}</span>
                </div>
                <div className="flex justify-between border-t border-neutral-700 pt-2 text-lg font-bold text-white">
                  <span>Total</span>
                  <span>{formatRand(quote.total)}</span>
                </div>
              </div>
            </div>
          )}

          <PaymentsNotOpenNote open={paymentsOpen} />

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-4 text-lg font-bold bg-[#D4A843] text-black transition-colors hover:bg-[#c49a3a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {quote ? `Continue, ${formatRand(quote.total)}` : !pkg && !category ? 'Choose the type of shoot to see the price' : 'Continue to Quote'}
          </button>
        </form>
      </div>
    </div>
  );
}
