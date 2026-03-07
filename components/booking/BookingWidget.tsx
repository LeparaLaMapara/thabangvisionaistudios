'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { CalendarDays, Info } from 'lucide-react';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';

interface Props {
  rental: SmartRental;
}

export function BookingWidget({ rental }: Props) {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRange>({
    start: null,
    end: null,
  });
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const pricing = useMemo(() => {
    if (dayCount === 0) return null;

    const dailyRate = rental.price_per_day ?? 0;
    const weeklyRate = rental.price_per_week ?? null;

    let total: number;
    let breakdown: string;

    if (weeklyRate && dayCount >= 7) {
      const fullWeeks = Math.floor(dayCount / 7);
      const extraDays = dayCount % 7;
      total = fullWeeks * weeklyRate + extraDays * dailyRate;
      breakdown =
        extraDays > 0
          ? `${fullWeeks} week${fullWeeks > 1 ? 's' : ''} + ${extraDays} day${extraDays > 1 ? 's' : ''}`
          : `${fullWeeks} week${fullWeeks > 1 ? 's' : ''}`;
    } else {
      total = dayCount * dailyRate;
      breakdown = `${dayCount} day${dayCount > 1 ? 's' : ''} x ${rental.currency} ${dailyRate}`;
    }

    return {
      total,
      breakdown,
      deposit: rental.deposit_amount ?? 0,
    };
  }, [dayCount, rental]);

  const checkAvailability = async (start: Date, end: Date) => {
    setChecking(true);
    setAvailable(null);
    setError(null);

    try {
      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];
      const res = await fetch(
        `/api/rentals/${rental.id}/availability?start_date=${startStr}&end_date=${endStr}`,
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Failed to check availability.');
        setAvailable(false);
      } else {
        setAvailable(data.available);
        if (!data.available) {
          setError('This item is already booked for the selected dates.');
        }
      }
    } catch {
      setError('Failed to check availability.');
      setAvailable(false);
    } finally {
      setChecking(false);
    }
  };

  const handleBook = async () => {
    if (!dateRange.start || !dateRange.end) {
      setError('Please select rental dates.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rental_id: rental.id,
          start_date: dateRange.start.toISOString().split('T')[0],
          end_date: dateRange.end.toISOString().split('T')[0],
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Booking failed.');
        setSubmitting(false);
        return;
      }

      // If PayFast payment URL is returned, redirect to PayFast checkout
      if (data.payment_url) {
        window.location.href = data.payment_url;
        return;
      }

      // No payment required — redirect to booking detail
      router.push(`/dashboard/bookings/${data.id}`);
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  if (!rental.is_available) {
    return (
      <div className="border border-dashed border-black/10 dark:border-white/10 p-6 text-center">
        <p className="text-sm text-neutral-500 font-mono">
          This item is currently unavailable for booking.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
    >
      {/* Date picker */}
      <DateRangePicker
        label="Rental Period"
        value={dateRange}
        onChange={(range) => {
          setDateRange(range);
          setError(null);
          setAvailable(null);
          if (range.start && range.end) {
            checkAvailability(range.start, range.end);
          }
        }}
        minDate={today}
        error={error ?? undefined}
      />

      {/* Availability indicator */}
      {checking && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500">
          <div className="w-3 h-3 border-2 border-neutral-300 dark:border-neutral-600 border-t-black dark:border-t-white rounded-full animate-spin" />
          Checking availability...
        </div>
      )}
      {available === true && !checking && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          Available for selected dates
        </div>
      )}
      {available === false && !checking && !error && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-red-600 dark:text-red-400">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          Unavailable for selected dates
        </div>
      )}

      {/* Price calculation */}
      {pricing && (
        <div className="border border-black/10 dark:border-white/10 p-4 space-y-3 bg-neutral-50 dark:bg-[#0A0A0B]">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500 font-mono">{pricing.breakdown}</span>
            <span className="font-mono font-bold text-black dark:text-white">
              {rental.currency} {pricing.total.toLocaleString()}
            </span>
          </div>

          {pricing.deposit > 0 && (
            <div className="flex justify-between text-sm border-t border-black/5 dark:border-white/5 pt-3">
              <span className="text-neutral-500 font-mono">Refundable deposit</span>
              <span className="font-mono text-neutral-600 dark:text-neutral-400">
                {rental.currency} {pricing.deposit.toLocaleString()}
              </span>
            </div>
          )}

          <div className="flex justify-between text-sm border-t border-black/10 dark:border-white/10 pt-3">
            <span className="text-black dark:text-white font-mono font-bold">
              Total due
            </span>
            <span className="text-black dark:text-white font-mono font-bold text-lg">
              {rental.currency} {(pricing.total + pricing.deposit).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Notes */}
      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Pickup/delivery preferences, special requirements..."
        rows={2}
        maxLength={500}
      />

      {/* Info line */}
      <div className="flex items-start gap-2 text-[9px] font-mono text-neutral-500">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Booking is subject to availability confirmation. Payment is processed
          securely via PayFast.
        </span>
      </div>

      {/* Book button */}
      <Button
        onClick={handleBook}
        loading={submitting}
        disabled={!dateRange.start || !dateRange.end || checking || available === false}
        className="w-full"
        size="lg"
      >
        <CalendarDays className="w-4 h-4" />
        {pricing
          ? `Book Now — ${rental.currency} ${(pricing.total + pricing.deposit).toLocaleString()}`
          : 'Select Dates to Book'}
      </Button>
    </motion.div>
  );
}
