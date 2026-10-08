'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BookingPackage } from './BookingForm';
import { isPaymentUrl } from '@/lib/payments/hosts';
import { formatRand } from '@/lib/format/money';
import { PaymentsNotOpenNote } from '@/components/booking/PaymentsNotOpenNote';

interface BookConfirmationProps {
  category: string;
  hours: number;
  deliverables: string;
  location: string;
  dates: string;
  description: string;
  creatorId: string | null;
  creatorName: string | null;
  hourlyRate: number;
  total: number;
  cancellationPolicy: string;
  /** A studio package booked at its own price. */
  pkg?: BookingPackage | null;
  /** What is being charged, e.g. "R1 500 per project". */
  rateLine?: string;
  /** onlinePaymentsOpen() from the server: the wording follows it. */
  paymentsOpen: boolean;
}

export default function BookConfirmation({
  category,
  hours,
  deliverables,
  location,
  dates,
  description,
  creatorId,
  creatorName,
  hourlyRate,
  total,
  cancellationPolicy,
  pkg = null,
  rateLine,
  paymentsOpen,
}: BookConfirmationProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handlePay() {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/service-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(pkg ? { production_id: pkg.id } : {}),
          creator_id: creatorId,
          booking_type: 'production',
          project_category: category,
          project_description: description || (pkg ? `Package: ${pkg.title}` : `${category} booking — ${hours} hours`),
          deliverables,
          duration_hours: hours,
          location: location || null,
          preferred_dates: dates || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create booking');
        setLoading(false);
        return;
      }

      if (data.paymentUrl && isPaymentUrl(data.paymentUrl)) {
        window.location.href = data.paymentUrl;
      } else {
        router.push(`/dashboard/bookings?ref=${data.booking?.reference}${data.payments_offline ? '&payment=offline' : ''}`);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-20">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-2xl font-bold text-white">{paymentsOpen ? 'Confirm Your Booking' : 'Send Your Request'}</h1>
        <p className="mb-8 text-neutral-400">
          {paymentsOpen
            ? 'Review the details below and pay to confirm.'
            : 'Review the details below and send your request. We reply to confirm who will shoot it and the date.'}
        </p>

        {/* Booking details card */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">{category}</h2>

          <div className="space-y-3 text-sm">
            {(!pkg || pkg.unit === 'hour') && (
              <Row label="Duration" value={`${hours} hour${hours !== 1 ? 's' : ''}`} />
            )}
            {deliverables && <Row label="Deliverables" value={deliverables} />}
            {location && <Row label="Location" value={location} />}
            {dates && <Row label="Date" value={dates} />}
            {description && <Row label="Description" value={description} />}
            <Row
              label="Creator"
              value={creatorName || 'We confirm who will shoot it with you'}
            />
          </div>

          {/* Pricing breakdown */}
          <div className="mt-6 border-t border-neutral-800 pt-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-neutral-400">
                <span>{pkg ? 'Package' : 'Rate'}</span>
                <span>{rateLine ?? `${formatRand(hourlyRate)}/hr × ${hours}hrs`}</span>
              </div>
              <div className="flex justify-between border-t border-neutral-700 pt-2 text-lg font-bold text-white">
                <span>Total</span>
                <span>{formatRand(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pay button */}
        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}

        <PaymentsNotOpenNote open={paymentsOpen} className="mt-6" />

        <button
          onClick={handlePay}
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-[#D4A843] px-6 py-4 text-lg font-bold text-black transition-colors hover:bg-[#c49a3a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? 'Processing...'
            : paymentsOpen
              ? `Pay ${formatRand(total)} securely`
              : `Send booking request, ${formatRand(total)}`}
        </button>

        {/* Policy */}
        <p className="mt-4 text-center text-xs text-neutral-400">
          {cancellationPolicy}
        </p>
        <p className="mt-2 text-center text-xs text-neutral-400">
          {paymentsOpen ? 'By paying' : 'By sending this request'}, you agree to our{' '}
          <a href="/legal" className="text-[#D4A843] underline">Terms of Service</a>.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-neutral-400">{label}</span>
      <span className="text-right text-neutral-200">{value}</span>
    </div>
  );
}
