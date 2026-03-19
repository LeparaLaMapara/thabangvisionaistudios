'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { MapPin, Calendar, Briefcase } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import type { CrewRequest } from '@/lib/supabase/queries/crew';

const TABS = ['all', 'pending', 'contacted', 'confirmed', 'paid', 'in_progress', 'completed'] as const;

const STATUS_MESSAGES: Record<string, string> = {
  pending: `${STUDIO.shortName} is reviewing a new request for you`,
  contacted: "We've reached out to discuss this opportunity with you",
  confirmed: 'Gig confirmed! Details to follow.',
  paid: 'Client has paid. Ready to start work.',
  in_progress: 'Work in progress.',
  declined: "This one didn't work out.",
  completed: 'Gig completed. Awaiting client review.',
  cancelled: 'This request was cancelled.',
  expired: 'This request expired due to no response within 48 hours.',
};

interface GigsListProps {
  gigs: CrewRequest[];
}

export default function GigsList({ gigs: initialGigs }: GigsListProps) {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [gigs, setGigs] = useState<CrewRequest[]>(initialGigs);
  const [loadingAction, setLoadingAction] = useState<Record<string, string>>({});

  const handleStatusUpdate = useCallback(async (gigId: string, newStatus: string) => {
    setLoadingAction((prev) => ({ ...prev, [gigId]: newStatus }));

    try {
      const res = await fetch(`/api/creator-requests/${gigId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error('[GigsList] Status update failed:', data.error);
        return;
      }

      // Optimistic update
      setGigs((prev) =>
        prev.map((g) =>
          g.id === gigId ? { ...g, status: newStatus, updated_at: new Date().toISOString() } : g,
        ),
      );
    } catch (err) {
      console.error('[GigsList] Status update error:', err);
    } finally {
      setLoadingAction((prev) => {
        const next = { ...prev };
        delete next[gigId];
        return next;
      });
    }
  }, []);

  const hasActiveGig = gigs.some((g) => ['confirmed', 'paid', 'in_progress'].includes(g.status));
  const filtered = activeTab === 'all' ? gigs : gigs.filter((g) => g.status === activeTab);

  const counts = {
    all: gigs.length,
    pending: gigs.filter((g) => g.status === 'pending').length,
    contacted: gigs.filter((g) => g.status === 'contacted').length,
    confirmed: gigs.filter((g) => g.status === 'confirmed').length,
    paid: gigs.filter((g) => g.status === 'paid').length,
    in_progress: gigs.filter((g) => g.status === 'in_progress').length,
    completed: gigs.filter((g) => g.status === 'completed').length,
  };

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

      {/* Gigs */}
      {filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map((gig) => (
            <Link
              key={gig.id}
              href={`/dashboard/gigs/${gig.id}`}
              className="block bg-[#0A0A0B] border border-white/5 p-5 hover:border-white/10 transition-colors"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h3 className="text-sm font-mono font-bold text-white uppercase">
                    {gig.project_type}
                  </h3>
                  <StatusBadge status={gig.status} />
                </div>
                <span className="text-[9px] font-mono text-neutral-600 flex-shrink-0">
                  via {gig.booked_via}
                </span>
              </div>

              <p className="text-xs font-mono text-neutral-300 leading-relaxed mb-3 line-clamp-2">
                {gig.description}
              </p>

              <div className="flex flex-wrap gap-4 text-[10px] font-mono text-neutral-500">
                {gig.preferred_dates && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {gig.preferred_dates}
                  </span>
                )}
                {gig.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {gig.location}
                  </span>
                )}
                {gig.budget_range && (
                  <span className="flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> {gig.budget_range}
                  </span>
                )}
                {gig.duration && (
                  <span>{gig.duration}</span>
                )}
              </div>

              <p className="text-[9px] font-mono text-neutral-600 mt-3 italic">
                {STATUS_MESSAGES[gig.status] || ''}
              </p>

              {/* Action Buttons */}
              {gig.status === 'pending' && (
                <div className="mt-3">
                  {hasActiveGig ? (
                    <p className="text-[10px] font-mono text-amber-400/80">
                      Finish your current gig before accepting a new one.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleStatusUpdate(gig.id, 'confirmed'); }}
                        disabled={!!loadingAction[gig.id]}
                        className="text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loadingAction[gig.id] === 'confirmed' ? 'Accepting...' : 'Accept'}
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleStatusUpdate(gig.id, 'declined'); }}
                        disabled={!!loadingAction[gig.id]}
                        className="text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loadingAction[gig.id] === 'declined' ? 'Declining...' : 'Decline'}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {gig.status === 'confirmed' && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleStatusUpdate(gig.id, 'completed'); }}
                    disabled={!!loadingAction[gig.id]}
                    className="text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingAction[gig.id] === 'completed' ? 'Completing...' : 'Mark Complete'}
                  </button>
                </div>
              )}
              {gig.status === 'paid' && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleStatusUpdate(gig.id, 'in_progress'); }}
                    disabled={!!loadingAction[gig.id]}
                    className="text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingAction[gig.id] === 'in_progress' ? 'Starting...' : 'Start Work'}
                  </button>
                </div>
              )}
              {gig.status === 'in_progress' && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleStatusUpdate(gig.id, 'completed'); }}
                    disabled={!!loadingAction[gig.id]}
                    className="text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingAction[gig.id] === 'completed' ? 'Completing...' : 'Mark Complete'}
                  </button>
                </div>
              )}

              <p className="text-[9px] font-mono text-neutral-700 mt-2">
                Submitted {new Date(gig.created_at).toLocaleDateString('en-ZA', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-neutral-500">
          <p className="text-sm font-mono">No gigs found.</p>
          <p className="text-[10px] font-mono text-neutral-600 mt-1">
            Gigs appear here when clients book you through the platform.
          </p>
        </div>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'text-amber-400 border-amber-500/30',
    contacted: 'text-blue-400 border-blue-500/30',
    confirmed: 'text-emerald-400 border-emerald-500/30',
    paid: 'text-green-400 border-green-500/30',
    in_progress: 'text-cyan-400 border-cyan-500/30',
    completed: 'text-neutral-400 border-neutral-500/30',
    declined: 'text-red-400 border-red-500/30',
    cancelled: 'text-neutral-500 border-neutral-600/30',
    expired: 'text-neutral-500 border-neutral-600/30',
  };

  const label =
    STUDIO.creators.statusLabels[status as keyof typeof STUDIO.creators.statusLabels] || status;

  return (
    <span
      className={`inline-block text-[8px] font-mono uppercase tracking-widest border px-2 py-0.5 mt-1 ${colors[status] || 'text-neutral-400 border-white/10'}`}
    >
      {label}
    </span>
  );
}
