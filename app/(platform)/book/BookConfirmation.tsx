'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  subtotal: number;
  vat: number;
  total: number;
  vatRate: number;
  cancellationPolicy: string;
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
  subtotal,
  vat,
  total,
  vatRate,
  cancellationPolicy,
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
          creator_id: creatorId,
          booking_type: 'production',
          project_category: category,
          project_description: description || `${category} booking — ${hours} hours`,
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

      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        router.push(`/dashboard/bookings?ref=${data.booking?.reference}`);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-20">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-2xl font-bold text-white">Confirm Your Booking</h1>
        <p className="mb-8 text-neutral-400">Review the details below and pay to confirm.</p>

        {/* Booking details card */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">{category}</h2>

          <div className="space-y-3 text-sm">
            <Row label="Duration" value={`${hours} hour${hours !== 1 ? 's' : ''}`} />
            {deliverables && <Row label="Deliverables" value={deliverables} />}
            {location && <Row label="Location" value={location} />}
            {dates && <Row label="Date" value={dates} />}
            {description && <Row label="Description" value={description} />}
            <Row
              label="Creator"
              value={creatorName || "We'll match you with the best available creator"}
            />
          </div>

          {/* Pricing breakdown */}
          <div className="mt-6 border-t border-neutral-800 pt-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-neutral-400">
                <span>Rate</span>
                <span>R{hourlyRate.toLocaleString()}/hr × {hours}hrs</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Subtotal</span>
                <span>R{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>VAT ({vatRate}%)</span>
                <span>R{vat.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-neutral-700 pt-2 text-lg font-bold text-white">
                <span>Total</span>
                <span>R{total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pay button */}
        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}

        <button
          onClick={handlePay}
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-[#D4A843] px-6 py-4 text-lg font-bold text-black transition-colors hover:bg-[#c49a3a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Processing...' : `Pay R${total.toLocaleString()} with Paystack`}
        </button>

        {/* Policy */}
        <p className="mt-4 text-center text-xs text-neutral-500">
          {cancellationPolicy}
        </p>
        <p className="mt-2 text-center text-xs text-neutral-600">
          By paying, you agree to our{' '}
          <a href="/legal" className="text-[#D4A843] underline">Terms of Service</a>.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right text-neutral-200">{value}</span>
    </div>
  );
}
