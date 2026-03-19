'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BookingStatus } from '@/types/booking-system';

interface ServiceBooking {
  id: string;
  reference: string;
  booking_type: string;
  project_category: string;
  project_description: string;
  deliverables: string;
  duration_hours: number;
  location: string | null;
  preferred_dates: string | null;
  subtotal: number;
  vat: number;
  total: number;
  creator_amount: number;
  payment_status: string;
  payout_status: string;
  status: BookingStatus;
  client_rating: number | null;
  created_at: string;
  creator: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    crew_slug: string | null;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400 border-yellow-500/30',
  paid: 'text-blue-400 border-blue-500/30',
  accepted: 'text-emerald-400 border-emerald-500/30',
  completed: 'text-green-400 border-green-500/30',
  paid_out: 'text-purple-400 border-purple-500/30',
  cancelled: 'text-red-400 border-red-500/30',
  disputed: 'text-orange-400 border-orange-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Payment',
  paid: 'Paid',
  accepted: 'Accepted',
  completed: 'Completed',
  paid_out: 'Paid Out',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

const TABS: BookingStatus[] = ['paid', 'accepted', 'completed', 'cancelled'];

export default function ServiceBookingsList({ bookings }: { bookings: ServiceBooking[] }) {
  const [activeTab, setActiveTab] = useState<BookingStatus | 'all'>('all');
  const [ratingBookingId, setRatingBookingId] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered = activeTab === 'all'
    ? bookings
    : bookings.filter((b) => b.status === activeTab);

  async function handleMarkComplete(bookingId: string) {
    try {
      const res = await fetch(`/api/service-bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (res.ok) window.location.reload();
    } catch { /* ignore */ }
  }

  async function handleSubmitReview(bookingId: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/service-bookings/${bookingId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, review }),
      });
      if (res.ok) {
        setRatingBookingId(null);
        window.location.reload();
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  }

  async function handleCancel(bookingId: string) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    try {
      const res = await fetch(`/api/service-bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', reason: 'Cancelled by client' }),
      });
      if (res.ok) window.location.reload();
    } catch { /* ignore */ }
  }

  return (
    <div>
      {/* Tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto">
        <TabButton active={activeTab === 'all'} onClick={() => setActiveTab('all')}>
          All ({bookings.length})
        </TabButton>
        {TABS.map((tab) => {
          const count = bookings.filter((b) => b.status === tab).length;
          if (count === 0) return null;
          return (
            <TabButton key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>
              {STATUS_LABELS[tab]} ({count})
            </TabButton>
          );
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-neutral-500">
          <p>No service bookings yet.</p>
          <p className="mt-2 text-sm">
            <Link href="/ubunye-ai-studio" className="text-[#D4A843] underline">
              Chat with Ubunye
            </Link>{' '}
            to book a production service.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((booking) => (
            <div
              key={booking.id}
              className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-neutral-500">{booking.reference}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[booking.status] || 'text-neutral-400 border-neutral-600'}`}>
                      {STATUS_LABELS[booking.status] || booking.status}
                    </span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-white">{booking.project_category}</h3>
                  <p className="mt-1 text-sm text-neutral-400">{booking.project_description}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">R{booking.total.toLocaleString()}</p>
                  <p className="text-xs text-neutral-500">incl. VAT</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-500">
                {booking.preferred_dates && <span>{booking.preferred_dates}</span>}
                {booking.location && <span>{booking.location}</span>}
                <span>{booking.duration_hours}hrs</span>
                {booking.creator && (
                  <span>Creator: {booking.creator.display_name}</span>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-3">
                {booking.status === 'accepted' && (
                  <button
                    onClick={() => handleMarkComplete(booking.id)}
                    className="rounded-lg bg-[#D4A843] px-4 py-2 text-sm font-medium text-black hover:bg-[#c49a3a]"
                  >
                    Mark as Complete
                  </button>
                )}

                {booking.status === 'completed' && !booking.client_rating && (
                  <button
                    onClick={() => setRatingBookingId(booking.id)}
                    className="rounded-lg border border-[#D4A843] px-4 py-2 text-sm font-medium text-[#D4A843] hover:bg-[#D4A843]/10"
                  >
                    Rate Creator
                  </button>
                )}

                {['paid', 'accepted'].includes(booking.status) && (
                  <button
                    onClick={() => handleCancel(booking.id)}
                    className="rounded-lg border border-red-600/30 px-4 py-2 text-sm text-red-400 hover:bg-red-600/10"
                  >
                    Cancel
                  </button>
                )}

                {booking.client_rating && (
                  <span className="flex items-center gap-1 text-sm text-yellow-400">
                    {'★'.repeat(booking.client_rating)}{'☆'.repeat(5 - booking.client_rating)}
                  </span>
                )}
              </div>

              {/* Rating modal inline */}
              {ratingBookingId === booking.id && (
                <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800 p-4">
                  <p className="mb-3 text-sm text-white">How was your experience?</p>
                  <div className="mb-3 flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setRating(star)}
                        className={`text-2xl ${star <= rating ? 'text-yellow-400' : 'text-neutral-600'}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={review}
                    onChange={(e) => setReview(e.target.value)}
                    placeholder="Write a review (optional)"
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500"
                    rows={3}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => handleSubmitReview(booking.id)}
                      disabled={submitting}
                      className="rounded-lg bg-[#D4A843] px-4 py-2 text-sm font-medium text-black hover:bg-[#c49a3a] disabled:opacity-50"
                    >
                      {submitting ? 'Submitting...' : 'Submit Review'}
                    </button>
                    <button
                      onClick={() => setRatingBookingId(null)}
                      className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-[#D4A843] text-black'
          : 'border border-neutral-700 text-neutral-400 hover:bg-neutral-800'
      }`}
    >
      {children}
    </button>
  );
}
