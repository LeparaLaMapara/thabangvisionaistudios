'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

type Booking = {
  id: string;
  user_id: string;
  rental_id: string;
  start_date: string;
  end_date: string;
  total_price: number;
  deposit_amount: number;
  status: string;
  notes: string | null;
  condition_at_checkout: string | null;
  condition_at_return: string | null;
  checkout_photos: string[];
  return_photos: string[];
  return_notes: string | null;
  returned_at: string | null;
  late_fee: number;
  created_at: string;
  rental?: { title: string; slug: string } | null;
  profile?: { full_name: string; email: string } | null;
};

type DepositAction = 'full_release' | 'partial_release' | 'no_release' | 'dispute';

const CONDITION_LABELS: Record<string, string> = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
  for_parts: 'For Parts',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReviewReturnPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [depositAction, setDepositAction] = useState<DepositAction>('full_release');
  const [partialAmount, setPartialAmount] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function fetchBooking(): Promise<void> {
      try {
        const res = await fetch(`/api/admin/rentals/${id}/review-return`, {
          method: 'GET',
        });

        // The review-return API is POST only, so fetch booking data directly
        const bookingRes = await fetch(`/api/admin/rentals?booking_id=${id}`);
        if (!bookingRes.ok) {
          // Fall back to fetching from Supabase via a general admin endpoint
          throw new Error('Failed to load booking');
        }
        const data = await bookingRes.json();
        setBooking(data.booking ?? data);
      } catch {
        // Direct Supabase fetch via admin API
        try {
          const res = await fetch(`/api/admin/rentals/${id}`);
          if (!res.ok) throw new Error('Booking not found');
          const data = await res.json();
          setBooking(data.booking ?? data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load booking');
        }
      } finally {
        setLoading(false);
      }
    }

    if (id) fetchBooking();
  }, [id]);

  async function handleSubmit(): Promise<void> {
    if (!booking) return;
    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        deposit_action: depositAction,
      };

      if (depositAction === 'partial_release') {
        const amount = parseFloat(partialAmount);
        if (isNaN(amount) || amount <= 0) {
          setError('Please enter a valid partial release amount');
          setSubmitting(false);
          return;
        }
        if (amount > (booking.deposit_amount ?? 0)) {
          setError('Partial amount cannot exceed the deposit');
          setSubmitting(false);
          return;
        }
        payload.deposit_release_amount = amount;
      }

      if (adminNotes.trim()) {
        payload.admin_notes = adminNotes.trim();
      }

      const res = await fetch(`/api/admin/rentals/${id}/review-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to submit review');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Loading / Error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505]">
        <Loader2 className="h-8 w-8 animate-spin text-[#D4A843]" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] px-4">
        <CheckCircle className="h-16 w-16 text-emerald-500" />
        <h1 className="text-2xl font-bold text-white">Review Submitted</h1>
        <p className="text-zinc-400">The renter has been notified.</p>
        <button
          onClick={() => router.push('/admin/rentals')}
          className="mt-4 rounded-lg bg-[#D4A843] px-6 py-2 font-medium text-black transition-colors hover:bg-[#c49a3a]"
        >
          Back to Rentals
        </button>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] px-4">
        <XCircle className="h-16 w-16 text-red-500" />
        <h1 className="text-2xl font-bold text-white">Booking Not Found</h1>
        <p className="text-zinc-400">{error ?? 'Could not load booking details.'}</p>
        <button
          onClick={() => router.push('/admin/rentals')}
          className="mt-4 rounded-lg border border-zinc-700 px-6 py-2 text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          Back to Rentals
        </button>
      </div>
    );
  }

  const depositAmount = booking.deposit_amount ?? 0;
  const lateFee = booking.late_fee ?? 0;
  const netDeposit = Math.max(depositAmount - lateFee, 0);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <button
          onClick={() => router.push('/admin/rentals')}
          className="mb-6 flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-[#D4A843]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Rentals
        </button>

        <h1 className="mb-2 text-3xl font-bold">Review Gear Return</h1>
        <p className="mb-8 text-zinc-400">
          Booking {booking.id.slice(0, 8)}...
          {booking.rental?.title ? ` — ${booking.rental.title}` : ''}
        </p>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Condition Comparison */}
        <div className="mb-8 grid gap-6 md:grid-cols-2">
          {/* Checkout Condition */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#D4A843]">
              Checkout Condition
            </h2>
            <p className="mb-3 text-sm text-zinc-300">
              Condition:{' '}
              <span className="font-medium text-white">
                {booking.condition_at_checkout
                  ? CONDITION_LABELS[booking.condition_at_checkout] ?? booking.condition_at_checkout
                  : 'Not recorded'}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(booking.checkout_photos ?? []).map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="overflow-hidden rounded-lg border border-zinc-700"
                >
                  <img
                    src={url}
                    alt={`Checkout photo ${i + 1}`}
                    className="h-32 w-full object-cover transition-transform hover:scale-105"
                  />
                </a>
              ))}
              {(!booking.checkout_photos || booking.checkout_photos.length === 0) && (
                <p className="col-span-2 text-sm text-zinc-500">No photos</p>
              )}
            </div>
          </div>

          {/* Return Condition */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#D4A843]">
              Return Condition
            </h2>
            <p className="mb-3 text-sm text-zinc-300">
              Condition:{' '}
              <span className="font-medium text-white">
                {booking.condition_at_return
                  ? CONDITION_LABELS[booking.condition_at_return] ?? booking.condition_at_return
                  : 'Not recorded'}
              </span>
            </p>
            {booking.return_notes && (
              <p className="mb-3 text-sm text-zinc-400">
                Renter notes: <span className="text-zinc-300">{booking.return_notes}</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {(booking.return_photos ?? []).map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="overflow-hidden rounded-lg border border-zinc-700"
                >
                  <img
                    src={url}
                    alt={`Return photo ${i + 1}`}
                    className="h-32 w-full object-cover transition-transform hover:scale-105"
                  />
                </a>
              ))}
              {(!booking.return_photos || booking.return_photos.length === 0) && (
                <p className="col-span-2 text-sm text-zinc-500">No photos</p>
              )}
            </div>
          </div>
        </div>

        {/* Financial Summary */}
        <div className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold text-[#D4A843]">Financial Summary</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-zinc-400">Deposit Held</p>
              <p className="text-xl font-bold">
                {STUDIO.currency.symbol}
                {depositAmount.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-400">Late Fee</p>
              <p className={`text-xl font-bold ${lateFee > 0 ? 'text-red-400' : 'text-zinc-300'}`}>
                {STUDIO.currency.symbol}
                {lateFee.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-400">Net Deposit (After Fees)</p>
              <p className="text-xl font-bold text-emerald-400">
                {STUDIO.currency.symbol}
                {netDeposit.toFixed(2)}
              </p>
            </div>
          </div>
          {booking.returned_at && (
            <p className="mt-3 text-sm text-zinc-500">
              Returned: {new Date(booking.returned_at).toLocaleString('en-ZA')}
            </p>
          )}
        </div>

        {/* Deposit Decision */}
        <div className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold text-[#D4A843]">Deposit Decision</h2>

          <div className="mb-6 space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 p-4 transition-colors hover:border-zinc-600">
              <input
                type="radio"
                name="deposit_action"
                value="full_release"
                checked={depositAction === 'full_release'}
                onChange={() => setDepositAction('full_release')}
                className="mt-0.5 accent-[#D4A843]"
              />
              <div>
                <p className="font-medium text-white">Full Release</p>
                <p className="text-sm text-zinc-400">
                  Refund entire deposit ({STUDIO.currency.symbol}
                  {netDeposit.toFixed(2)}
                  {lateFee > 0 ? ` after R${lateFee.toFixed(2)} late fee` : ''}) to the renter
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 p-4 transition-colors hover:border-zinc-600">
              <input
                type="radio"
                name="deposit_action"
                value="partial_release"
                checked={depositAction === 'partial_release'}
                onChange={() => setDepositAction('partial_release')}
                className="mt-0.5 accent-[#D4A843]"
              />
              <div className="flex-1">
                <p className="font-medium text-white">Partial Release</p>
                <p className="text-sm text-zinc-400">Refund a portion of the deposit</p>
                {depositAction === 'partial_release' && (
                  <div className="mt-3">
                    <label className="mb-1 block text-sm text-zinc-400">
                      Amount to release ({STUDIO.currency.code})
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={depositAmount}
                      step="0.01"
                      value={partialAmount}
                      onChange={(e) => setPartialAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-48 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder-zinc-500 focus:border-[#D4A843] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 p-4 transition-colors hover:border-zinc-600">
              <input
                type="radio"
                name="deposit_action"
                value="no_release"
                checked={depositAction === 'no_release'}
                onChange={() => setDepositAction('no_release')}
                className="mt-0.5 accent-[#D4A843]"
              />
              <div>
                <p className="font-medium text-white">No Release</p>
                <p className="text-sm text-zinc-400">
                  Retain full deposit due to damage or other issues
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-red-500/30 p-4 transition-colors hover:border-red-500/50">
              <input
                type="radio"
                name="deposit_action"
                value="dispute"
                checked={depositAction === 'dispute'}
                onChange={() => setDepositAction('dispute')}
                className="mt-0.5 accent-red-500"
              />
              <div>
                <AlertTriangle className="mb-1 inline h-4 w-4 text-red-400" />
                <p className="inline font-medium text-red-400"> Escalate to Dispute</p>
                <p className="text-sm text-zinc-400">
                  Hold deposit and mark for further investigation
                </p>
              </div>
            </label>
          </div>

          {/* Admin Notes */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-zinc-400">
              Admin Notes (optional)
            </label>
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={3}
              placeholder="Any notes about the return condition, fees, or issues..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 focus:border-[#D4A843] focus:outline-none"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold transition-colors ${
              depositAction === 'dispute'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-[#D4A843] text-black hover:bg-[#c49a3a]'
            } disabled:opacity-50`}
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Processing...
              </>
            ) : depositAction === 'dispute' ? (
              'Escalate to Dispute'
            ) : (
              'Confirm Decision'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
