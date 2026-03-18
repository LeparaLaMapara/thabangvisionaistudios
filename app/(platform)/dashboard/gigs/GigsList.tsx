'use client';

import { useState } from 'react';
import { MapPin, Calendar, Briefcase } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import type { CrewRequest } from '@/lib/supabase/queries/crew';

const TABS = ['all', 'pending', 'contacted', 'confirmed', 'completed'] as const;

const STATUS_MESSAGES: Record<string, string> = {
  pending: `${STUDIO.shortName} is reviewing a new request for you`,
  contacted: "We've reached out to discuss this opportunity with you",
  confirmed: 'Gig confirmed! Details to follow.',
  declined: "This one didn't work out.",
  completed: 'Gig completed. Awaiting client review.',
  cancelled: 'This request was cancelled.',
};

interface GigsListProps {
  gigs: CrewRequest[];
}

export default function GigsList({ gigs }: GigsListProps) {
  const [activeTab, setActiveTab] = useState<string>('all');

  const filtered = activeTab === 'all' ? gigs : gigs.filter((g) => g.status === activeTab);

  const counts = {
    all: gigs.length,
    pending: gigs.filter((g) => g.status === 'pending').length,
    contacted: gigs.filter((g) => g.status === 'contacted').length,
    confirmed: gigs.filter((g) => g.status === 'confirmed').length,
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
            {STUDIO.crew.statusLabels[tab as keyof typeof STUDIO.crew.statusLabels] || 'All'}{' '}
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
            <div
              key={gig.id}
              className="bg-[#0A0A0B] border border-white/5 p-5"
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

              <p className="text-[9px] font-mono text-neutral-700 mt-2">
                Submitted {new Date(gig.created_at).toLocaleDateString('en-ZA', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
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
    completed: 'text-neutral-400 border-neutral-500/30',
    declined: 'text-red-400 border-red-500/30',
    cancelled: 'text-neutral-500 border-neutral-600/30',
  };

  const label =
    STUDIO.crew.statusLabels[status as keyof typeof STUDIO.crew.statusLabels] || status;

  return (
    <span
      className={`inline-block text-[8px] font-mono uppercase tracking-widest border px-2 py-0.5 mt-1 ${colors[status] || 'text-neutral-400 border-white/10'}`}
    >
      {label}
    </span>
  );
}
