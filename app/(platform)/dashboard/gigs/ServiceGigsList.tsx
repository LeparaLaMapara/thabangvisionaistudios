'use client';

import { useState } from 'react';

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
  accepted_at: string | null;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid: 'text-blue-400 border-blue-500/30',
  accepted: 'text-emerald-400 border-emerald-500/30',
  completed: 'text-green-400 border-green-500/30',
  paid_out: 'text-purple-400 border-purple-500/30',
  cancelled: 'text-red-400 border-red-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  paid: 'New — Accept or Decline',
  accepted: 'In Progress',
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

  const actionable = gigs.filter((g) => g.status === 'paid');
  const active = gigs.filter((g) => g.status === 'accepted');
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

  if (gigs.length === 0) {
    return (
      <div className="py-8 text-center text-neutral-500">
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
              <GigCard key={gig.id} gig={gig} updating={updating} onAction={handleAction} />
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-500">Completed</h3>
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
}: {
  gig: ServiceGig;
  updating: string | null;
  onAction: (id: string, status: 'accepted' | 'cancelled') => void;
  showActions?: boolean;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-neutral-500">{gig.reference}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[gig.status] || 'text-neutral-400 border-neutral-600'}`}>
              {STATUS_LABELS[gig.status] || gig.status}
            </span>
          </div>
          <h3 className="mt-1 text-lg font-semibold text-white">{gig.project_category}</h3>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-[#D4A843]">R{gig.creator_amount.toLocaleString()}</p>
          <p className="text-xs text-neutral-500">your earnings</p>
        </div>
      </div>

      <p className="mt-2 text-sm text-neutral-400">{gig.project_description}</p>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-500">
        <span>{gig.duration_hours}hrs</span>
        {gig.deliverables && <span>{gig.deliverables}</span>}
        {gig.location && <span>{gig.location}</span>}
        {gig.preferred_dates && <span>{gig.preferred_dates}</span>}
      </div>

      {/* Payout status for completed gigs */}
      {['completed', 'paid_out'].includes(gig.status) && (
        <div className="mt-3 text-xs">
          <span className="text-neutral-500">Payout: </span>
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

      {/* Actions */}
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
    </div>
  );
}
