'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MapPin, Calendar, Briefcase, X, User, Clock } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import type { CrewRequest } from '@/lib/supabase/queries/crew';

const TABS = ['all', 'pending', 'confirmed', 'completed', 'cancelled'] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-400 border-amber-500/30',
  contacted: 'text-blue-400 border-blue-500/30',
  confirmed: 'text-emerald-400 border-emerald-500/30',
  completed: 'text-neutral-400 border-neutral-500/30',
  declined: 'text-red-400 border-red-500/30',
  cancelled: 'text-neutral-500 border-neutral-600/30',
  expired: 'text-neutral-500 border-neutral-600/30',
};

interface CreatorRequestsListProps {
  requests: CrewRequest[];
}

export default function CreatorRequestsList({ requests: initialRequests }: CreatorRequestsListProps) {
  const router = useRouter();
  const [requests, setRequests] = useState<CrewRequest[]>(initialRequests);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const filtered = activeTab === 'all' ? requests : requests.filter((r) => r.status === activeTab);

  const counts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === 'pending').length,
    confirmed: requests.filter((r) => r.status === 'confirmed').length,
    completed: requests.filter((r) => r.status === 'completed').length,
    cancelled: requests.filter((r) => r.status === 'cancelled').length,
  };

  async function handleCancel(requestId: string) {
    setCancellingId(requestId);

    // Optimistic update
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, status: 'cancelled' } : r)),
    );

    try {
      const res = await fetch(`/api/creator-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });

      if (!res.ok) {
        // Revert on failure
        setRequests((prev) =>
          prev.map((r) => (r.id === requestId ? { ...r, status: 'pending' } : r)),
        );
      }
    } catch {
      // Revert on error
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: 'pending' } : r)),
      );
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <>
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-[10px] font-mono uppercase tracking-widest px-3 py-2 border transition-all min-h-[36px] ${
              activeTab === tab
                ? 'bg-white text-black border-white'
                : 'bg-transparent text-neutral-500 border-white/10 hover:border-white/30'
            }`}
          >
            {STUDIO.creators.statusLabels[tab as keyof typeof STUDIO.creators.statusLabels] || 'All'}{' '}
            {counts[tab as keyof typeof counts] > 0 && (
              <span className="ml-1 text-[9px]">({counts[tab as keyof typeof counts]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Requests */}
      {filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map((request) => {
            const creator = request.creator;

            return (
              <div
                key={request.id}
                onClick={() => router.push(`/dashboard/creator-requests/${request.id}`)}
                className="block bg-[#0A0A0B] border border-white/5 p-5 hover:border-white/10 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    {creator?.display_name && (
                      <Link
                        href={`/smart-creators/${creator.crew_slug || creator.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843] hover:text-[#D4A843]/80 transition-colors flex items-center gap-1 mb-1"
                      >
                        <User className="w-3 h-3" />
                        {creator.display_name}
                      </Link>
                    )}
                    <h3 className="text-sm font-mono font-bold text-white uppercase">
                      {request.project_type}
                    </h3>
                    <StatusBadge status={request.status} />
                  </div>
                  {request.status === 'pending' && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCancel(request.id); }}
                      disabled={cancellingId === request.id}
                      className="text-[9px] font-mono uppercase tracking-widest text-red-400 border border-red-500/30 px-2 py-1 hover:bg-red-500/10 transition-colors flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
                    >
                      <X className="w-3 h-3" />
                      {cancellingId === request.id ? 'Cancelling...' : 'Cancel Request'}
                    </button>
                  )}
                </div>

                <p className="text-xs font-mono text-neutral-300 leading-relaxed mb-3 line-clamp-2">
                  {request.description}
                </p>

                <div className="flex flex-wrap gap-4 text-[10px] font-mono text-neutral-500">
                  {request.preferred_dates && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {request.preferred_dates}
                    </span>
                  )}
                  {request.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {request.location}
                    </span>
                  )}
                  {request.budget_range && (
                    <span className="flex items-center gap-1">
                      <Briefcase className="w-3 h-3" /> {request.budget_range}
                    </span>
                  )}
                  {request.duration && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {request.duration}
                    </span>
                  )}
                </div>

                <p className="text-[9px] font-mono text-neutral-700 mt-3">
                  Submitted{' '}
                  {new Date(request.created_at).toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 text-neutral-500">
          <p className="text-sm font-mono">No creator requests yet.</p>
          <p className="text-[10px] font-mono text-neutral-600 mt-1">
            Browse creators at{' '}
            <Link href="/smart-creators" className="text-[#D4A843] hover:text-[#D4A843]/80 transition-colors">
              /smart-creators
            </Link>{' '}
            or ask Ubunye to find the perfect match.
          </p>
        </div>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    STUDIO.creators.statusLabels[status as keyof typeof STUDIO.creators.statusLabels] || status;

  return (
    <span
      className={`inline-block text-[8px] font-mono uppercase tracking-widest border px-2 py-0.5 mt-1 ${STATUS_COLORS[status] || 'text-neutral-400 border-white/10'}`}
    >
      {label}
    </span>
  );
}
