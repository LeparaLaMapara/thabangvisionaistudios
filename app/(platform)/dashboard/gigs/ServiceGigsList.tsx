'use client';

import { useEffect, useState } from 'react';
import { ShootTimeline } from '@/components/booking/ShootTimeline';
import { Modal } from '@/components/ui/Modal';
import { payoutTimingText, revisionsAllowed } from '@/lib/core/services/fulfilment';
import {
  answerByAt,
  canCheckIn,
  formatSastDateTime,
  formatShootDate,
  hoursLeftToAnswer,
} from '@/lib/bookings/answer-by';
import { pastGigReason, splitCreatorGigs } from '@/lib/bookings/creator-gigs';

/** A job passed to another creator: the booking is no longer theirs, so it comes from the alert. */
export interface ReassignedGig {
  id: string;
  body: string;
  created_at: string;
}

/** Tap targets: at least 44px tall on a phone. */
const BTN = 'min-h-[44px] rounded-lg px-4 text-sm font-medium disabled:opacity-50';

interface ServiceGig {
  id: string;
  reference: string;
  booking_type: string;
  project_category: string;
  project_description: string;
  deliverables: string;
  duration_hours: number;
  location: string | null;
  preferred_dates: string | null;
  creator_amount: number;
  payment_status: string;
  payout_status: string;
  status: string;
  client_rating: number | null;
  client_review: string | null;
  created_at: string;
  paid_at?: string | null;
  /** When an admin last gave this job to this creator: the answer clock restarts then. */
  assigned_at?: string | null;
  accepted_at: string | null;
  arrived_at?: string | null;
  delivered_at?: string | null;
  completed_at: string | null;
  shoot_date?: string | null;
  revisions_included?: number | null;
  revisions_used?: number | null;
  payout_due_at?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
  cancellation_reason?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid: 'text-blue-400 border-blue-500/30',
  accepted: 'text-emerald-400 border-emerald-500/30',
  delivered: 'text-cyan-400 border-cyan-500/30',
  completed: 'text-green-400 border-green-500/30',
  paid_out: 'text-purple-400 border-purple-500/30',
  cancelled: 'text-red-400 border-red-500/30',
  declined: 'text-red-400 border-red-500/30',
  disputed: 'text-orange-400 border-orange-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  paid: 'New: accept or decline',
  accepted: 'In Progress',
  delivered: 'Delivered, awaiting approval',
  completed: 'Completed',
  paid_out: 'Paid Out',
  cancelled: 'Cancelled',
  declined: 'Declined',
  disputed: 'Disputed, payout on hold',
};

const PAYOUT_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed, contact us',
};

/** "Now", set after the first render so server and browser render the same HTML. */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  return now;
}

export default function ServiceGigsList({ gigs, reassigned = [] }: { gigs: ServiceGig[]; reassigned?: ReassignedGig[] }) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [deliveryError, setDeliveryError] = useState('');
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [declining, setDeclining] = useState<ServiceGig | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const now = useNow();

  const { actionable, active, completed, past } = splitCreatorGigs(gigs);

  async function handleAction(gigId: string, action: 'accept' | 'decline', reason?: string) {
    setUpdating(gigId);
    setActionError(null);
    try {
      const res = await fetch(`/api/service-bookings/${gigId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: reason ?? null }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setActionError({ id: gigId, message: data.error || 'Could not update this gig. Please try again.' });
    } catch {
      setActionError({ id: gigId, message: 'Something went wrong. Please try again.' });
    }
    setUpdating(null);
  }

  async function handleDeliver(gigId: string) {
    if (!deliveryUrl.trim()) {
      setDeliveryError('Please provide a delivery URL');
      return;
    }

    setUpdating(gigId);
    setDeliveryError('');
    try {
      const res = await fetch(`/api/service-bookings/${gigId}/deliver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_url: deliveryUrl.trim(),
          delivery_message: deliveryMessage.trim() || null,
        }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json();
        setDeliveryError(data.error || 'Failed to submit delivery');
      }
    } catch {
      setDeliveryError('Something went wrong');
    }
    setUpdating(null);
  }

  if (gigs.length === 0 && reassigned.length === 0) {
    return (
      <div className="py-8 text-center text-neutral-400">
        <p>No service gigs yet.</p>
        <p className="mt-1 text-sm">When clients book you, their gigs will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* New gigs requiring action */}
      {actionable.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-[#D4A843]">
            New Gigs: Accept or Decline
          </h3>
          <div className="space-y-3">
            {actionable.map((gig) => (
              <GigCard
                key={gig.id}
                gig={gig}
                now={now}
                updating={updating}
                onAction={handleAction}
                actionError={actionError?.id === gig.id ? actionError.message : null}
                showActions
                onStartDecline={(g) => {
                  setDeclineReason('');
                  setDeclining(g);
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Active gigs */}
      {active.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-emerald-400">Active Gigs</h3>
          <div className="space-y-3">
            {active.map((gig) => (
              <GigCard
                key={gig.id}
                gig={gig}
                now={now}
                updating={updating}
                onAction={handleAction}
                showDeliver={gig.status === 'accepted'}
                deliveringId={deliveringId}
                onStartDeliver={() => {
                  setDeliveringId(gig.id);
                  setDeliveryUrl('');
                  setDeliveryMessage('');
                  setDeliveryError('');
                }}
                onCancelDeliver={() => setDeliveringId(null)}
                deliveryUrl={deliveryUrl}
                deliveryMessage={deliveryMessage}
                deliveryError={deliveryError}
                onDeliveryUrlChange={setDeliveryUrl}
                onDeliveryMessageChange={setDeliveryMessage}
                onSubmitDelivery={() => handleDeliver(gig.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">Completed</h3>
          <div className="space-y-3">
            {completed.map((gig) => (
              <GigCard key={gig.id} gig={gig} now={now} updating={updating} onAction={handleAction} />
            ))}
          </div>
        </section>
      )}

      {/* Past: cancelled, declined and passed to another creator, so nothing just vanishes */}
      {(past.length > 0 || reassigned.length > 0) && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-500">Past</h3>
          <ul className="space-y-2">
            {past.map((gig) => (
              <li key={gig.id} className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs text-neutral-500">{gig.reference}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[gig.status] || 'text-neutral-400 border-neutral-600'}`}>
                    {STATUS_LABELS[gig.status] || gig.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-300">{gig.project_category}</p>
                <p className="mt-1 text-xs text-neutral-500">{pastGigReason(gig)}</p>
              </li>
            ))}
            {reassigned.map((r) => (
              <li key={r.id} className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
                <span className="rounded-full border border-neutral-600 px-2 py-0.5 text-xs text-neutral-400">
                  Passed to another creator
                </span>
                <p className="mt-2 text-xs text-neutral-500">{r.body}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {new Date(r.created_at).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Decline, in the page instead of browser pop-ups */}
      <Modal
        isOpen={declining !== null}
        onClose={() => setDeclining(null)}
        title="Decline this job?"
        size="sm"
      >
        {declining && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-300">
              {declining.project_category} ({declining.reference}). The client is refunded in full and we offer them another creator.
            </p>
            <label className="block text-xs text-neutral-400">
              Why can you not take it? (optional, shared with our team only)
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-[#D4A843] focus:outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  const g = declining;
                  setDeclining(null);
                  void handleAction(g.id, 'decline', declineReason.trim());
                }}
                disabled={updating === declining.id}
                className={`${BTN} border border-red-600/40 text-red-400 hover:bg-red-600/10`}
              >
                Yes, decline
              </button>
              <button
                type="button"
                onClick={() => setDeclining(null)}
                className={`${BTN} border border-neutral-700 text-neutral-300 hover:bg-neutral-800`}
              >
                Keep the job
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function GigCard({
  gig,
  now,
  onStartDecline,
  updating,
  onAction,
  actionError = null,
  showActions = false,
  showDeliver = false,
  deliveringId,
  onStartDeliver,
  onCancelDeliver,
  deliveryUrl,
  deliveryMessage,
  deliveryError,
  onDeliveryUrlChange,
  onDeliveryMessageChange,
  onSubmitDelivery,
}: {
  gig: ServiceGig;
  /** Null until the page is in the browser; time-based bits wait for it. */
  now: Date | null;
  onStartDecline?: (gig: ServiceGig) => void;
  updating: string | null;
  onAction: (id: string, action: 'accept' | 'decline', reason?: string) => void;
  actionError?: string | null;
  showActions?: boolean;
  showDeliver?: boolean;
  deliveringId?: string | null;
  onStartDeliver?: () => void;
  onCancelDeliver?: () => void;
  deliveryUrl?: string;
  deliveryMessage?: string;
  deliveryError?: string;
  onDeliveryUrlChange?: (v: string) => void;
  onDeliveryMessageChange?: (v: string) => void;
  onSubmitDelivery?: () => void;
}) {
  const isDelivering = deliveringId === gig.id;
  const [arrived, setArrived] = useState(Boolean(gig.arrived_at));
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  async function checkIn() {
    setCheckingIn(true);
    setCheckInError(null);
    const res = await fetch(`/api/service-bookings/${gig.id}/arrived`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    setCheckingIn(false);
    if (res.ok) setArrived(true);
    else setCheckInError(json.error ?? 'Could not check in.');
  }

  return (
    <div id={`gig-${gig.id}`} className="scroll-mt-24 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-neutral-400">{gig.reference}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[gig.status] || 'text-neutral-400 border-neutral-600'}`}>
              {STATUS_LABELS[gig.status] || gig.status}
            </span>
          </div>
          <h3 className="mt-1 text-lg font-semibold text-white">{gig.project_category}</h3>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-[#D4A843]">R{gig.creator_amount.toLocaleString()}</p>
          <p className="text-xs text-neutral-400">your earnings</p>
        </div>
      </div>

      <p className="mt-2 text-sm text-neutral-400">{gig.project_description}</p>

      {/* The booked shoot date (the one check-in and refunds use), not the client's free text */}
      <p className="mt-3 text-sm text-white">
        {gig.shoot_date ? (
          <>Shoot: <span className="font-medium">{formatShootDate(gig.shoot_date)}</span></>
        ) : (
          <span className="text-neutral-400">Shoot date to be confirmed by our team</span>
        )}
      </p>
      {!gig.shoot_date && gig.preferred_dates && (
        <p className="mt-1 text-xs text-neutral-500">Client&apos;s note on dates: {gig.preferred_dates}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-400">
        <span>{gig.duration_hours}hrs</span>
        {gig.deliverables && <span>{gig.deliverables}</span>}
        {gig.location && <span>{gig.location}</span>}
      </div>

      {/* The answer-by deadline: after it, the daily job passes the job to another creator */}
      {gig.status === 'paid' && !gig.accepted_at && (
        <p className="mt-3 rounded-lg border border-[#D4A843]/30 bg-[#D4A843]/5 px-3 py-2 text-xs text-[#D4A843]">
          Answer by {formatSastDateTime(answerByAt(gig))}
          {now && <> ({hoursLeftToAnswer(gig, now)} hours left)</>}. If you do not accept or decline by then, the job goes to another creator.
        </p>
      )}

      <ShootTimeline booking={gig} viewer="creator" />

      {/* "I'm here" only on the shoot day; before it, say when it opens */}
      {gig.status === 'accepted' && !arrived && now && gig.shoot_date && !canCheckIn(gig.shoot_date, now) && (
        <p className="mt-3 text-xs text-neutral-400">
          You can tap &quot;I&apos;m here&quot; on the shoot day, {formatShootDate(gig.shoot_date)}.
        </p>
      )}
      {gig.status === 'accepted' && !arrived && now && canCheckIn(gig.shoot_date, now) && (
        <button
          onClick={checkIn}
          disabled={checkingIn}
          className="mt-3 min-h-[44px] rounded-lg border border-[#D4A843] px-4 text-sm font-medium text-[#D4A843] disabled:opacity-50"
        >
          {checkingIn ? 'Checking in…' : 'I’m here'}
        </button>
      )}
      {checkInError && <p className="mt-2 text-xs text-red-400">{checkInError}</p>}

      {/* Revisions */}
      {['accepted', 'delivered'].includes(gig.status) && (gig.revisions_used ?? 0) > 0 && (
        <p className="mt-3 text-xs text-yellow-400">
          Revision {gig.revisions_used} of {revisionsAllowed(gig.revisions_included)} requested
          {gig.status === 'accepted' ? '. Deliver the revised work below.' : '.'}
        </p>
      )}

      {/* When the payout is due (when we send it, never when the bank shows it) */}
      {gig.status === 'completed' && gig.payout_status !== 'paid' && gig.payout_due_at && (
        <p className="mt-3 text-xs text-neutral-400">
          Payout due to be sent{' '}
          {new Date(gig.payout_due_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })}.{' '}
          {payoutTimingText()}
        </p>
      )}
      {gig.status === 'disputed' && (
        <p className="mt-3 text-xs text-orange-400">
          The client raised a problem. Your payout is on hold until our team resolves it; we will contact you.
        </p>
      )}

      {/* Payout status for completed gigs */}
      {['completed', 'paid_out'].includes(gig.status) && (
        <div className="mt-3 text-xs">
          <span className="text-neutral-400">Payout: </span>
          <span className={gig.payout_status === 'paid' ? 'text-green-400' : gig.payout_status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>
            {PAYOUT_LABELS[gig.payout_status] || gig.payout_status}
          </span>
        </div>
      )}

      {/* Rating */}
      {gig.client_rating && (
        <div className="mt-2 text-sm">
          <span className="text-yellow-400">{'★'.repeat(gig.client_rating)}{'☆'.repeat(5 - gig.client_rating)}</span>
          {gig.client_review && <p className="mt-1 text-xs text-neutral-400 italic">&quot;{gig.client_review}&quot;</p>}
        </div>
      )}

      {/* Accept/Decline actions */}
      {showActions && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => onAction(gig.id, 'accept')}
            disabled={updating === gig.id}
            className={`${BTN} bg-[#D4A843] text-black hover:bg-[#c49a3a]`}
          >
            {updating === gig.id ? 'Updating...' : 'Accept Gig'}
          </button>
          <button
            onClick={() => onStartDecline?.(gig)}
            disabled={updating === gig.id}
            className={`${BTN} border border-red-600/30 text-red-400 hover:bg-red-600/10`}
          >
            Decline
          </button>
        </div>
      )}

      {actionError && <p className="mt-2 text-xs text-red-400">{actionError}</p>}

      {/* Deliver button for accepted gigs */}
      {showDeliver && !isDelivering && (
        <div className="mt-4">
          <button
            onClick={onStartDeliver}
            className={`${BTN} bg-[#D4A843] text-black hover:bg-[#c49a3a]`}
          >
            Deliver Work
          </button>
        </div>
      )}

      {/* Delivery form */}
      {isDelivering && (
        <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800 p-4">
          <p className="mb-3 text-sm font-medium text-white">Submit Delivery</p>
          <input
            type="url"
            value={deliveryUrl}
            onChange={(e) => onDeliveryUrlChange?.(e.target.value)}
            placeholder="Delivery link (Google Drive, Dropbox, etc.)"
            className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-[#D4A843] focus:outline-none"
          />
          <textarea
            value={deliveryMessage}
            onChange={(e) => onDeliveryMessageChange?.(e.target.value)}
            placeholder="Message to client (optional)"
            className="mb-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-[#D4A843] focus:outline-none"
            rows={2}
          />
          {deliveryError && (
            <p className="mb-2 text-xs text-red-400">{deliveryError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onSubmitDelivery}
              disabled={updating === gig.id}
              className={`${BTN} bg-[#D4A843] text-black hover:bg-[#c49a3a]`}
            >
              {updating === gig.id ? 'Submitting...' : 'Submit Delivery'}
            </button>
            <button
              onClick={onCancelDeliver}
              className={`${BTN} border border-neutral-700 text-neutral-400 hover:bg-neutral-800`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delivered status info */}
      {gig.status === 'delivered' && (
        <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <p className="text-xs text-cyan-400">
            Delivered, waiting for client approval
          </p>
        </div>
      )}
    </div>
  );
}
