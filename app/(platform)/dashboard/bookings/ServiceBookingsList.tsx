'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BookingStatus } from '@/types/booking-system';
import { ShootTimeline } from '@/components/booking/ShootTimeline';
import { ReportProblemDialog, ReportFiledNote } from '@/components/disputes/ReportProblemDialog';
import { STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { clientServiceActions } from '@/lib/bookings/client-actions';

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
  payment_status: string;
  payout_status: string;
  status: BookingStatus;
  delivery_url: string | null;
  delivery_message: string | null;
  delivered_at: string | null;
  revisions_used?: number | null;
  revisions_included?: number | null;
  dispute_window_ends_at?: string | null;
  paid_at?: string | null;
  accepted_at?: string | null;
  arrived_at?: string | null;
  completed_at?: string | null;
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
  delivered: 'text-cyan-400 border-cyan-500/30',
  completed: 'text-green-400 border-green-500/30',
  paid_out: 'text-purple-400 border-purple-500/30',
  cancelled: 'text-red-400 border-red-500/30',
  disputed: 'text-orange-400 border-orange-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for payment',
  paid: 'Paid: waiting for your creator',
  accepted: 'Creator confirmed',
  delivered: 'Delivered: your review',
  completed: 'Completed',
  paid_out: 'Paid Out',
  cancelled: 'Cancelled',
  declined: 'Creator could not take it',
  disputed: 'Being reviewed',
};

const TABS: BookingStatus[] = ['delivered', 'paid', 'accepted', 'completed', 'cancelled'];

export default function ServiceBookingsList({ bookings }: { bookings: ServiceBooking[] }) {
  const [activeTab, setActiveTab] = useState<BookingStatus | 'all'>('all');
  const [ratingBookingId, setRatingBookingId] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered = activeTab === 'all'
    ? bookings
    : bookings.filter((b) => b.status === activeTab);

  // One note per booking: what the last action did, or why it did not.
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const [changesText, setChangesText] = useState('');
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reported, setReported] = useState<Record<string, boolean>>({});
  const note = (id: string, ok: boolean, text: string) => setNotes((n) => ({ ...n, [id]: { ok, text } }));

  /** PATCH the status route; returns the JSON on success, or shows the server's reason. */
  async function act(bookingId: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(bookingId);
    try {
      const res = await fetch(`/api/service-bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        note(bookingId, false, typeof data.error === 'string' ? data.error : 'That did not go through. Nothing was changed; please try again.');
        return null;
      }
      return data;
    } catch {
      note(bookingId, false, 'We could not reach the server. Nothing was changed; please try again.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove(bookingId: string) {
    if (!confirm(`Approve this work? Approving confirms it is complete. The creator is paid ${STUDIO.booking.payoutDelayHours} hours later; until then you can still report a problem.`)) return;
    const done = await act(bookingId, { action: 'approve_delivery' });
    if (done) {
      note(bookingId, true, 'Approved. Thank you. A short review below helps the next client choose.');
      setRatingBookingId(bookingId);
    }
  }

  async function handleRequestChanges(bookingId: string) {
    const what = changesText.trim();
    if (!what) {
      note(bookingId, false, 'Tell the creator what to change.');
      return;
    }
    const done = await act(bookingId, { action: 'request_revision', reason: what.slice(0, 1000) });
    if (done) {
      setChangesFor(null);
      setChangesText('');
      note(bookingId, true, 'Sent to your creator. They deliver the changes here, and we let you know.');
      setTimeout(() => window.location.reload(), 1500);
    }
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
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        note(bookingId, false, data.error ?? 'Your review was not saved. Please try again.');
      }
    } catch {
      note(bookingId, false, 'We could not reach the server. Your review is still here: please try again.');
    }
    setSubmitting(false);
  }

  async function handleCancel(bookingId: string) {
    // The rule, before the decision; the exact amount comes back from the server.
    if (!confirm(`Cancel this booking?\n\n${STUDIO.booking.cancellationPolicy}\n\nRefunds go back to the card you paid with.`)) return;
    const done = await act(bookingId, { action: 'cancel', reason: 'Cancelled by client' });
    if (!done) return;
    const q = done.cancellation as { totalRefund?: number; refundPercent?: number } | null | undefined;
    const status = done.refund_status as string | null | undefined;
    const amount = typeof q?.totalRefund === 'number' ? formatRand(q.totalRefund) : null;
    note(
      bookingId,
      true,
      status === 'refunded'
        ? `Cancelled. ${amount} is being refunded to the card you paid with. When it shows depends on your bank.`
        : status === 'not_required'
          ? amount && q?.refundPercent === 0
            ? 'Cancelled. Under the cancellation policy no refund is due this close to the shoot.'
            : 'Cancelled. Nothing was charged, so there is nothing to refund.'
          : `Cancelled. ${amount ? `Your refund of ${amount}` : 'Your refund'} could not be sent automatically; a person on our team is completing it and will contact you.`,
    );
    setTimeout(() => window.location.reload(), 2500);
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
        <div className="py-12 text-center text-neutral-400">
          <p>No service bookings yet.</p>
          <p className="mt-2 text-sm">
            <Link href="/studio" className="text-[#D4A843] underline">
              Browse production packages
            </Link>{' '}
            to book a service.
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
                    <span className="text-xs font-mono text-neutral-400">{booking.reference}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[booking.status] || 'text-neutral-400 border-neutral-600'}`}>
                      {STATUS_LABELS[booking.status] || booking.status}
                    </span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-white">{booking.project_category}</h3>
                  <p className="mt-1 text-sm text-neutral-400">{booking.project_description}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">R{booking.total.toLocaleString()}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-400">
                {booking.preferred_dates && <span>{booking.preferred_dates}</span>}
                {booking.location && <span>{booking.location}</span>}
                <span>{booking.duration_hours}hrs</span>
                {booking.creator && (
                  <span>Creator: {booking.creator.display_name}</span>
                )}
              </div>

              {/* Delivery info */}
              <ShootTimeline booking={booking} viewer="client" />

              {booking.status === 'delivered' && booking.delivery_url && (
                <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <p className="text-sm font-medium text-cyan-400 mb-2">
                    Deliverables Ready
                  </p>
                  {booking.delivery_message && (
                    <p className="text-sm text-neutral-300 mb-3 italic">
                      &quot;{booking.delivery_message}&quot;
                    </p>
                  )}
                  <a
                    href={booking.delivery_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[#D4A843] underline hover:text-[#E5B954]"
                  >
                    View Deliverables &rarr;
                  </a>
                  {booking.delivered_at && (
                    <p className="mt-2 text-xs text-neutral-400">
                      Delivered {new Date(booking.delivered_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
              )}

              {/* What the client can do now: the same rules the server enforces */}
              {(() => {
                const can = clientServiceActions(booking, new Date());
                const btn = 'min-h-[44px] rounded-lg px-4 py-2 text-sm';
                return (
                  <>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {can.approve && (
                        <button onClick={() => handleApprove(booking.id)} disabled={busy === booking.id} className={`${btn} bg-[#D4A843] font-medium text-black hover:bg-[#c49a3a] disabled:opacity-50`}>
                          Approve the work
                        </button>
                      )}
                      {can.changesLeft > 0 && changesFor !== booking.id && (
                        <button onClick={() => { setChangesFor(booking.id); setChangesText(''); }} className={`${btn} border border-[#D4A843] text-[#D4A843] hover:bg-[#D4A843]/10`}>
                          Ask for changes ({can.changesLeft} left)
                        </button>
                      )}
                      {can.report && !reported[booking.id] && (
                        <button onClick={() => setReportFor(booking.id)} className={`${btn} border border-neutral-700 text-neutral-300 hover:bg-neutral-800`}>
                          Report a problem
                        </button>
                      )}
                      {can.cancel && (
                        <button onClick={() => handleCancel(booking.id)} disabled={busy === booking.id} className={`${btn} border border-red-600/30 text-red-400 hover:bg-red-600/10 disabled:opacity-50`}>
                          Cancel
                        </button>
                      )}
                      {booking.client_rating && (
                        <span className="flex items-center gap-1 text-sm text-yellow-400" aria-label={`You rated ${booking.client_rating} out of 5`}>
                          {'★'.repeat(booking.client_rating)}{'☆'.repeat(5 - booking.client_rating)}
                        </span>
                      )}
                      {can.rate && ratingBookingId !== booking.id && (
                        <button onClick={() => setRatingBookingId(booking.id)} className={`${btn} border border-[#D4A843] font-medium text-[#D4A843] hover:bg-[#D4A843]/10`}>
                          Rate Creator
                        </button>
                      )}
                    </div>

                    {changesFor === booking.id && (
                      <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800 p-4">
                        <label htmlFor={`changes-${booking.id}`} className="mb-2 block text-sm text-white">What should the creator change?</label>
                        <textarea
                          id={`changes-${booking.id}`}
                          value={changesText}
                          onChange={(e) => setChangesText(e.target.value)}
                          maxLength={1000}
                          rows={3}
                          placeholder="For example: brighter edits on the reception photos, and remove the blurry ones."
                          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500"
                        />
                        <p className="mt-1 text-xs text-neutral-400">
                          This uses one of your {can.changesLeft} revision round{can.changesLeft === 1 ? '' : 's'}. Approval waits until the new delivery.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button onClick={() => handleRequestChanges(booking.id)} disabled={busy === booking.id} className={`${btn} bg-[#D4A843] font-medium text-black hover:bg-[#c49a3a] disabled:opacity-50`}>
                            Send to the creator
                          </button>
                          <button onClick={() => setChangesFor(null)} className={`${btn} border border-neutral-700 text-neutral-400 hover:bg-neutral-800`}>
                            Not now
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {notes[booking.id] && (
                <p role={notes[booking.id].ok ? 'status' : 'alert'} className={`mt-3 text-sm ${notes[booking.id].ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {notes[booking.id].text}
                </p>
              )}
              {reported[booking.id] && <div className="mt-4"><ReportFiledNote /></div>}

              {/* Rating modal inline */}
              {ratingBookingId === booking.id && (
                <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800 p-4">
                  <p className="mb-3 text-sm text-white">How was your experience?</p>
                  <div className="mb-3 flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setRating(star)}
                        aria-label={`${star} star${star === 1 ? '' : 's'}`}
                        aria-pressed={star <= rating}
                        className={`min-h-[44px] min-w-[44px] text-2xl ${star <= rating ? 'text-yellow-400' : 'text-neutral-400'}`}
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

      {reportFor && (
        <ReportProblemDialog
          kind="service"
          bookingId={reportFor}
          isOpen
          onClose={() => setReportFor(null)}
          onFiled={() => {
            setReported((r) => ({ ...r, [reportFor]: true }));
            setReportFor(null);
            // Filing a report moves the booking to "disputed": reload so it no
            // longer offers cancel / approve / changes the server would refuse.
            setTimeout(() => window.location.reload(), 2500);
          }}
        />
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
      className={`min-h-[44px] whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-[#D4A843] text-black'
          : 'border border-neutral-700 text-neutral-400 hover:bg-neutral-800'
      }`}
    >
      {children}
    </button>
  );
}
