'use client';

import { useState } from 'react';
import type { CrewMember } from '@/lib/supabase/queries/crew';
import CreatorCard from './CreatorCard';

const FILTER_OPTIONS = ['All', 'Photography', 'Cinematography', 'Editing', 'Sound', 'Directing'];

interface CreatorFilterProps {
  creators: CrewMember[];
}

export default function CreatorFilter({ creators }: CreatorFilterProps) {
  const [activeFilter, setActiveFilter] = useState('All');

  const filtered =
    activeFilter === 'All'
      ? creators
      : creators.filter((m) =>
          m.specializations?.some((s) => s.toLowerCase() === activeFilter.toLowerCase()),
        );

  return (
    <>
      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 mb-8">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setActiveFilter(option)}
            className={`text-[10px] font-mono uppercase tracking-widest px-4 py-2 border transition-all min-h-[36px] ${
              activeFilter === option
                ? 'bg-white text-black border-white'
                : 'bg-transparent text-neutral-500 border-white/10 hover:border-white/30'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((member) => (
            <CreatorCard key={member.id} member={member} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-sm font-mono text-neutral-500">
            No creators found for &ldquo;{activeFilter}&rdquo;. Try a different filter.
          </p>
        </div>
      )}
    </>
  );
}
