'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { MapPin, Star, ArrowUpRight, Search, Filter, X, Command } from 'lucide-react';
import type { CreatorProfile } from '@/lib/supabase/queries/smartProductions';
import { STUDIO, CREATOR_JOIN, EARN } from '@/lib/constants';
import { EmptyState } from '@/components/ui/EmptyState';
import { creatorProfilePath } from '@/lib/seo/creator-url';
import { formatRate } from '@/lib/format/money';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getCreatorHref(creator: CreatorProfile): string {
  return creatorProfilePath(creator);
}

// ─── CreatorCard ────────────────────────────────────────────────────────────────

function CreatorCard({
  creator,
  index,
}: {
  creator: CreatorProfile;
  index: number;
}) {
  const href = getCreatorHref(creator);
  const specializations = creator.specializations?.slice(0, 3) ?? [];
  const portfolioThumb =
    creator.portfolio_projects?.[0]?.photos?.[0]?.url ?? creator.avatar_url;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.4) }}
    >
      <Link href={href} className="group block">
        <div className="relative h-[400px] overflow-hidden bg-[#0A0A0B] border border-white/5 hover:border-[#D4A843]/30 transition-colors duration-300">
          {/* Image / Fallback */}
          {portfolioThumb ? (
            <Image
              src={portfolioThumb}
              alt={creator.display_name ?? 'Creator'}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
              <span className="text-4xl font-bold text-white/20">
                {getInitials(creator.display_name)}
              </span>
            </div>
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

          {/* Featured badge */}
          {creator.crew_featured && (
            <div className="absolute top-3 left-3 px-2 py-1 bg-[#D4A843] text-black text-xs font-bold uppercase tracking-wider">
              Featured
            </div>
          )}

          {/* Arrow */}
          <div className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowUpRight className="w-4 h-4 text-white" />
          </div>

          {/* Info */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="flex items-center gap-2 mb-1">
              {creator.avatar_url && (
                <Image
                  src={creator.avatar_url}
                  alt=""
                  width={24}
                  height={24}
                  className="rounded-full border border-white/20"
                />
              )}
              <h3 className="text-white font-semibold text-sm truncate">
                {creator.display_name ?? 'Creator'}
              </h3>
            </div>

            {creator.location && (
              <div className="flex items-center gap-1 text-white/50 text-xs mb-2">
                <MapPin className="w-3 h-3" />
                <span>{creator.location}</span>
              </div>
            )}

            {specializations.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {specializations.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-0.5 text-xs uppercase tracking-wider bg-white/10 text-white/70"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}

            {creator.hourly_rate && (
              <p className="text-[#D4A843] text-xs font-medium">
                From {formatRate(creator.hourly_rate, 'hour')}
              </p>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function SmartCreatorsClient({
  creators,
}: {
  creators: CreatorProfile[];
}) {
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  // Extract unique specializations and locations for filters
  const allSpecializations = useMemo(() => {
    const specs = new Set<string>();
    creators.forEach((c) => c.specializations?.forEach((s) => specs.add(s)));
    return Array.from(specs).sort();
  }, [creators]);

  const allLocations = useMemo(() => {
    const locs = new Set<string>();
    creators.forEach((c) => {
      if (c.location) locs.add(c.location);
    });
    return Array.from(locs).sort();
  }, [creators]);

  // Filter creators
  const filtered = useMemo(() => {
    let result = creators;

    if (selectedSpec) {
      result = result.filter((c) =>
        c.specializations?.includes(selectedSpec),
      );
    }

    if (selectedLocation) {
      result = result.filter((c) => c.location === selectedLocation);
    }

    return result;
  }, [creators, selectedSpec, selectedLocation]);

  const hasFilters = selectedSpec || selectedLocation;

  return (
    <section className="min-h-screen bg-[#050505] pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            People
          </h1>
          <p className="text-white/50 max-w-2xl text-sm sm:text-base">
            Photographers and filmmakers you can book. Everyone on this page has
            passed an ID check and has a complete portfolio.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          {/* Cmd+K search hint */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('toggle-search'))}
            className="flex items-center gap-2 px-3 py-2.5 bg-white/5 border border-white/10 text-white/30 text-sm hover:border-[#D4A843]/30 transition-colors sm:min-w-[200px]"
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Search creators...</span>
            <kbd className="hidden sm:flex items-center gap-0.5 text-xs font-mono text-white/20 border border-white/10 px-1.5 py-0.5">
              <Command className="w-2.5 h-2.5" />K
            </kbd>
          </button>

          {/* Specialization filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
            <select
              value={selectedSpec ?? ''}
              onChange={(e) => setSelectedSpec(e.target.value || null)}
              className="appearance-none pl-10 pr-8 py-2.5 bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-[#D4A843]/50 min-w-[160px]"
            >
              <option value="">All Skills</option>
              {allSpecializations.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Location filter */}
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
            <select
              value={selectedLocation ?? ''}
              onChange={(e) => setSelectedLocation(e.target.value || null)}
              className="appearance-none pl-10 pr-8 py-2.5 bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-[#D4A843]/50 min-w-[160px]"
            >
              <option value="">All Locations</option>
              {allLocations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active filters */}
        {hasFilters && (
          <div className="flex items-center gap-2 mb-6">
            <span className="text-white/40 text-xs">
              {filtered.length} {filtered.length !== 1 ? 'people' : 'person'} found
            </span>
            <button
              onClick={() => {
                setSelectedSpec(null);
                setSelectedLocation(null);
              }}
              className="flex items-center gap-1 text-xs text-[#D4A843] hover:text-[#D4A843]/80 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          </div>
        )}

        {/* Grid */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((creator, i) => (
              <CreatorCard key={creator.id} creator={creator} index={i} />
            ))}
          </div>
        ) : creators.length === 0 ? (
          <EmptyState
            icon={<Star className="w-10 h-10 text-[#D4A843]/40" />}
            title={CREATOR_JOIN.emptyDirectoryTitle}
            description={CREATOR_JOIN.emptyDirectoryText}
            action={{ label: CREATOR_JOIN.emptyDirectoryCta, href: EARN.href }}
          />
        ) : (
          <EmptyState
            icon={<Search className="w-10 h-10 text-white/20" />}
            title="No matches"
            description="Try adjusting your search or filters."
          />
        )}
      </div>
    </section>
  );
}
