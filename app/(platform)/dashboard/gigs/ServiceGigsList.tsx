'use client';

import { useState } from 'react';
import { ShootTimeline } from '@/components/booking/ShootTimeline';

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
  accepted_at: string | null;
  arrived_at?: string | null;
  delivered_at?: string | null;
  completed_at: string | null;
  shoot_date?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid: 'text-blue-400 border-blue-500/30',
  accepted: 'text-emerald-400 border-emerald-500/30',
  delivered: 'text-cyan-400 border-cyan-500/30',
  completed: 'text-green-400 border-green-500/30',
  paid_out: 'text-purple-400 border-purple-500/30',
  cancelled: 'text-red-400 border-red-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  paid: 'New — Accept or Decline',
  accepted: 'In Progress',
  delivered: 'Delivered — Awaiting Approval',
  completed: 'Completed',
  paid_out: 'Paid Out',
  cancelled: 'Cancelled',
};

const PAYOUT_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed — Contact Admin',
};

export default function ServiceGigsList({ gigs }: { gigs: ServiceGig[] }) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [deliveryError, setDeliveryError] = useState('');

  const actionable = gigs.filter((g) => g.status === 'paid');
  const active = gigs.filter((g) => ['accepted', 'delivered'].includes(g.status));
  const completed = gigs.filter((g) => ['completed', 'paid_out'].includes(g.status));

  async function handleAction(gigId: string, status: 'accepted' | 'cancelled') {
    setUpdating(gigId);
    try {
      const res = await fetch(`/api/service-bookings/${gigId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) window.location.reload();
    } catch { /* ignore */ }
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

  if (gigs.length === 0) {
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
            New Gigs — Accept or Decline
          </h3>
          <div className="space-y-3">
            {actionable.map((gig) => (
              <GigCard key={gig.id} gig={gig} updating={updating} onAction={handleAction} showActions />
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
              <GigCard key={gig.id} gig={gig} updating={updating} onAction={handleAction} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function GigCard({
  gig,
  updating,
  onAction,
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
  updating: string | null;
  onAction: (id: string, status: 'accepted' | 'cancelled') => void;
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
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

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-400">
        <span>{gig.duration_hours}hrs</span>
        {gig.deliverables && <span>{gig.deliverables}</span>}
        {gig.location && <span>{gig.location}</span>}
        {gig.preferred_dates && <span>{gig.preferred_dates}</span>}
      </div>

      <ShootTimeline booking={gig} viewer="creator" />

      {gig.status === 'accepted' && !arrived && (
        <button
          onClick={checkIn}
          disabled={checkingIn}
          className="mt-3 min-h-[44px] rounded-lg border border-[#D4A843] px-4 text-sm font-medium text-[#D4A843] disabled:opacity-50"
        >
          {checkingIn ? 'Checking in…' : 'I’m here'}
        </button>
      )}
      {checkInError && <p className="mt-2 text-xs text-red-400">{checkInError}</p>}

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
            onClick={() => onAction(gig.id, 'accepted')}
            disabled={updating === gig.id}
            className="rounded-lg bg-[#D4A843] px-4 py-2 text-sm font-medium text-black hover:bg-[#c49a3a] disabled:opacity-50"
          >
            {updating === gig.id ? 'Updating...' : 'Accept Gig'}
          </button>
          <button
            onClick={() => {
              if (confirm('Are you sure you want to decline this gig?')) {
                onAction(gig.id, 'cancelled');
              }
            }}
            disabled={updating === gig.id}
            className="rounded-lg border border-red-600/30 px-4 py-2 text-sm text-red-400 hover:bg-red-600/10 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}

      {/* Deliver button for accepted gigs */}
      {showDeliver && !isDelivering && (
        <div className="mt-4">
          <button
            onClick={onStartDeliver}
            className="rounded-lg bg-[#D4A843] px-4 py-2 text-sm font-medium text-black hover:bg-[#c49a3a]"
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
              className="rounded-lg bg-[#D4A843] px-4 py-2 text-sm font-medium text-black hover:bg-[#c49a3a] disabled:opacity-50"
            >
              {updating === gig.id ? 'Submitting...' : 'Submit Delivery'}
            </button>
            <button
              onClick={onCancelDeliver}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
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
            Delivered — waiting for client approval
          </p>
        </div>
      )}
    </div>
  );
}
