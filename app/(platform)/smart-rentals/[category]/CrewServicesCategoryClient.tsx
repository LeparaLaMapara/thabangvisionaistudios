'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, SlidersHorizontal, X, Check, ArrowRight,
  ShieldCheck, Building2, Users, Camera, Film,
} from 'lucide-react';
import type { CrewWithPortfolio } from '@/lib/supabase/queries/crew';

// ─── Cloudinary thumbnail helper ──────────────────────────────────────────────

function cloudinaryThumb(url: string, width = 600): string {
  return url.replace(
    /\/upload\/(?:v\d+\/)?/,
    `/upload/w_${width},c_fill,f_auto,q_auto/`,
  );
}

// ─── Image shimmer skeleton ───────────────────────────────────────────────────

function ImageSkeleton(): React.ReactElement {
  return (
    <div className="absolute inset-0 bg-neutral-900 animate-pulse">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]" />
    </div>
  );
}

// ─── Accordion filter section ─────────────────────────────────────────────────

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/10 py-5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full justify-between items-center group"
      >
        <span className="text-xs font-bold uppercase tracking-widest text-white group-hover:text-neutral-400 transition-colors">
          {title}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-neutral-500 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-4 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Anonymous Crew Card ────────────────────────────────────────────────────

function CrewCard({ crew }: { crew: CrewWithPortfolio }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const onLoad = useCallback(() => setImageLoaded(true), []);

  // Use first portfolio_projects image, fallback to smart_productions portfolio
  const thumbnailUrl = useMemo(() => {
    // Prefer creator-uploaded portfolio
    for (const p of crew.portfolio_projects ?? []) {
      if (p.photos?.length > 0) return cloudinaryThumb(p.photos[0].url);
    }
    // Fallback to smart_productions portfolio
    for (const p of crew.portfolio) {
      if (p.thumbnail_url) return cloudinaryThumb(p.thumbnail_url);
      if (p.gallery && p.gallery.length > 0) return cloudinaryThumb(p.gallery[0].url);
    }
    return null;
  }, [crew.portfolio, crew.portfolio_projects]);

  const photoCount = useMemo(() => {
    const ownPhotos = (crew.portfolio_projects ?? []).reduce((acc, p) => acc + (p.photos?.length ?? 0), 0);
    const prodPhotos = crew.portfolio.reduce((acc, p) => acc + (p.gallery?.length ?? 0) + (p.thumbnail_url ? 1 : 0), 0);
    return ownPhotos + prodPhotos;
  }, [crew.portfolio, crew.portfolio_projects]);

  const hasVideo = (crew.portfolio_projects ?? []).some((p) => p.video) || crew.portfolio.some((p) => p.video_url);

  // Use crew_slug or id as the detail page slug
  const slug = crew.crew_slug ?? crew.id;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group relative bg-[#0A0A0B] border border-white/5 hover:border-white/20 transition-all duration-300 flex flex-col"
    >
      {/* Status badges */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-1.5">
        {crew.crew_featured ? (
          <span className="flex items-center gap-1 bg-[#D4A843] text-black text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <Building2 className="w-2.5 h-2.5" />
            Studio
          </span>
        ) : (
          <span className="flex items-center gap-1 bg-violet-500/90 backdrop-blur-md text-white text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <Users className="w-2.5 h-2.5" />
            Community
          </span>
        )}
        <span className="flex items-center gap-1 bg-emerald-600 text-white text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
          <ShieldCheck className="w-2.5 h-2.5" />
          Verified
        </span>
      </div>

      {/* Available badge */}
      <div className="absolute top-3 right-3 z-20">
        <div className="flex items-center gap-1.5 bg-green-500/10 backdrop-blur-md px-2 py-1 rounded-full border border-green-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[9px] font-mono font-bold text-green-400 uppercase tracking-widest">
            Available
          </span>
        </div>
      </div>

      {/* Photo count + video badge */}
      <div className="absolute bottom-[calc(100%-theme(spacing.3))] right-3 z-20 flex items-center gap-1.5 translate-y-full">
        {photoCount > 0 && (
          <span className="flex items-center gap-1 bg-black/70 backdrop-blur-md text-white text-[9px] font-mono px-2 py-0.5">
            <Camera className="w-2.5 h-2.5" />
            {photoCount}
          </span>
        )}
        {hasVideo && (
          <span className="flex items-center gap-1 bg-black/70 backdrop-blur-md text-white text-[9px] font-mono px-2 py-0.5">
            <Film className="w-2.5 h-2.5" />
          </span>
        )}
      </div>

      {/* Portfolio preview image */}
      <div className="relative aspect-square overflow-hidden bg-neutral-900">
        {thumbnailUrl ? (
          <>
            {!imageLoaded && <ImageSkeleton />}
            <Image
              src={thumbnailUrl}
              alt="Creator portfolio work"
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className={`object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 scale-95 group-hover:scale-105 transition-all duration-700 ease-out ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={onLoad}
              unoptimized
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
              No portfolio yet
            </span>
          </div>
        )}
      </div>

      {/* Content — anonymous: specializations + rate only */}
      <div className="p-5 flex-grow flex flex-col justify-between">
        <div>
          {/* Primary specialization as title */}
          <h3 className="text-lg font-display font-medium text-white uppercase leading-tight mb-2 group-hover:underline decoration-1 underline-offset-4">
            {crew.specializations[0] ?? 'Creative Professional'}
          </h3>

          {/* Additional specializations as chips */}
          {crew.specializations.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {crew.specializations.slice(1, 4).map((spec) => (
                <span
                  key={spec}
                  className="text-[9px] font-mono text-neutral-400 border border-white/10 px-1.5 py-0.5 bg-white/5 uppercase"
                >
                  {spec}
                </span>
              ))}
            </div>
          )}

          {/* Location */}
          {crew.location && (
            <p className="text-[10px] font-mono text-neutral-500 mb-3 uppercase tracking-widest">
              {crew.location}
            </p>
          )}

          {/* Experience */}
          {crew.years_experience != null && (
            <p className="text-[10px] font-mono text-neutral-500 mb-4">
              {crew.years_experience} year{crew.years_experience !== 1 ? 's' : ''} experience
            </p>
          )}
        </div>

        <div>
          {/* Rate */}
          {crew.hourly_rate != null ? (
            <div className="flex items-end gap-1 mb-4">
              <span className="text-sm font-bold text-white">
                ZAR {crew.hourly_rate.toLocaleString()}
              </span>
              <span className="text-[10px] text-neutral-500 mb-0.5">/ hour</span>
            </div>
          ) : (
            <p className="text-[10px] font-mono text-neutral-500 mb-4 uppercase tracking-widest">
              Contact for rates
            </p>
          )}

          <Link
            href={`/smart-rentals/crew-services/${slug}`}
            className="w-full py-3 text-[10px] font-mono font-bold uppercase tracking-widest transition-all relative overflow-hidden group/btn bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 flex items-center justify-center gap-2"
          >
            View Work
            <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

type SortKey = 'recommended' | 'newest' | 'rateAsc' | 'rateDesc' | 'experience';

export default function CrewServicesCategoryClient({
  crew,
}: {
  crew: CrewWithPortfolio[];
}) {
  // Derive filter options from data
  const allSpecializations = useMemo(() => {
    const set = new Set<string>();
    for (const c of crew) {
      for (const s of c.specializations) set.add(s);
    }
    return Array.from(set).sort();
  }, [crew]);

  const allLocations = useMemo(() => {
    return Array.from(new Set(crew.map((c) => c.location).filter(Boolean) as string[])).sort();
  }, [crew]);

  const maxCatalogRate = useMemo(
    () => Math.max(0, ...crew.map((c) => c.hourly_rate ?? 0)),
    [crew],
  );

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedSpecs, setSelectedSpecs] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [maxRate, setMaxRate] = useState<number>(maxCatalogRate);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'studio' | 'community'>('all');
  const [sortBy, setSortBy] = useState<SortKey>('recommended');

  useEffect(() => {
    setMaxRate(maxCatalogRate);
  }, [maxCatalogRate]);

  const filtered = useMemo(() => {
    return crew
      .filter((c) => {
        if (selectedSpecs.length > 0 && !selectedSpecs.some((s) => c.specializations.includes(s))) return false;
        if (selectedLocations.length > 0 && !selectedLocations.includes(c.location ?? '')) return false;
        if (maxRate > 0 && (c.hourly_rate ?? 0) > maxRate) return false;
        if (sourceFilter === 'studio' && !c.crew_featured) return false;
        if (sourceFilter === 'community' && c.crew_featured) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'recommended') {
          // Featured first, then by portfolio size
          if (a.crew_featured !== b.crew_featured) return a.crew_featured ? -1 : 1;
          return b.portfolio.length - a.portfolio.length;
        }
        if (sortBy === 'rateAsc') return (a.hourly_rate ?? 0) - (b.hourly_rate ?? 0);
        if (sortBy === 'rateDesc') return (b.hourly_rate ?? 0) - (a.hourly_rate ?? 0);
        if (sortBy === 'experience') return (b.years_experience ?? 0) - (a.years_experience ?? 0);
        // newest — no created_at on profiles in our type, use id order as proxy
        return 0;
      });
  }, [crew, selectedSpecs, selectedLocations, maxRate, sourceFilter, sortBy]);

  const hasStudioCrew = useMemo(() => crew.some((c) => c.crew_featured), [crew]);

  const clearFilters = () => {
    setSelectedSpecs([]);
    setSelectedLocations([]);
    setMaxRate(maxCatalogRate);
    setSourceFilter('all');
  };

  // ── Filter panel (shared between desktop sidebar + mobile modal) ──────────
  const FilterContent = () => (
    <div className="space-y-1">
      {allSpecializations.length > 0 && (
        <FilterSection title="Specialization">
          {allSpecializations.map((spec) => (
            <label key={spec} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-4 h-4 border flex items-center justify-center transition-colors flex-shrink-0 ${
                  selectedSpecs.includes(spec)
                    ? 'bg-[#D4A843] border-[#D4A843]'
                    : 'border-neutral-400'
                }`}
              >
                {selectedSpecs.includes(spec) && <Check className="w-3 h-3 text-black" />}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={selectedSpecs.includes(spec)}
                onChange={() =>
                  setSelectedSpecs((prev) =>
                    prev.includes(spec) ? prev.filter((s) => s !== spec) : [...prev, spec],
                  )
                }
              />
              <span className="text-xs font-mono text-neutral-400 group-hover:text-white uppercase">
                {spec}
              </span>
            </label>
          ))}
        </FilterSection>
      )}

      {allLocations.length > 0 && (
        <FilterSection title="Location">
          {allLocations.map((loc) => (
            <label key={loc} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-4 h-4 border flex items-center justify-center transition-colors flex-shrink-0 ${
                  selectedLocations.includes(loc)
                    ? 'bg-[#D4A843] border-[#D4A843]'
                    : 'border-neutral-400'
                }`}
              >
                {selectedLocations.includes(loc) && <Check className="w-3 h-3 text-black" />}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={selectedLocations.includes(loc)}
                onChange={() =>
                  setSelectedLocations((prev) =>
                    prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc],
                  )
                }
              />
              <span className="text-xs font-mono text-neutral-400 group-hover:text-white uppercase">
                {loc}
              </span>
            </label>
          ))}
        </FilterSection>
      )}

      {maxCatalogRate > 0 && (
        <FilterSection title="Hourly Rate">
          <div className="px-1 pt-2">
            <input
              type="range"
              min={0}
              max={maxCatalogRate}
              step={50}
              value={maxRate}
              onChange={(e) => setMaxRate(Number(e.target.value))}
              className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-[#D4A843] rounded-lg"
            />
            <div className="flex justify-between mt-4 font-mono text-xs text-neutral-500">
              <span>0</span>
              <span className="text-[#D4A843] font-bold">
                Max: ZAR {maxRate.toLocaleString()}
              </span>
            </div>
          </div>
        </FilterSection>
      )}

      {hasStudioCrew && (
        <FilterSection title="Source">
          {(['all', 'studio', 'community'] as const).map((opt) => (
            <label key={opt} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors flex-shrink-0 ${
                  sourceFilter === opt
                    ? 'bg-[#D4A843] border-[#D4A843]'
                    : 'border-neutral-400'
                }`}
              >
                {sourceFilter === opt && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
              </div>
              <input
                type="radio"
                className="hidden"
                name="source"
                checked={sourceFilter === opt}
                onChange={() => setSourceFilter(opt)}
              />
              <span className="text-xs font-mono text-neutral-400 group-hover:text-white uppercase">
                {opt === 'all' ? 'All Crew' : opt === 'studio' ? 'Studio Crew' : 'Community Crew'}
              </span>
            </label>
          ))}
        </FilterSection>
      )}

      <div className="pt-8">
        <button
          onClick={clearFilters}
          className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors border-b border-transparent hover:border-white pb-0.5"
        >
          Clear All Filters
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-white pt-20 transition-colors duration-500">

      {/* ── Breadcrumbs + header ── */}
      <div className="bg-[#080808] border-b border-white/5 py-12">
        <div className="container mx-auto px-6">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-6">
            <Link href="/" className="hover:text-white">Home</Link>
            <span>/</span>
            <Link href="/smart-rentals" className="hover:text-white">Smart Rentals</Link>
            <span>/</span>
            <span className="text-white">Crew Services</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-medium uppercase tracking-tight">
            Crew Services
          </h1>
          <p className="text-sm text-neutral-400 mt-3 max-w-xl font-light">
            Verified creative professionals available for hire. Browse their work — identity is revealed after booking is confirmed and paid.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">

        {/* ── Mobile filter toggle ── */}
        <div className="lg:hidden mb-6 flex justify-between items-center">
          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest border border-white px-4 py-2"
          >
            <SlidersHorizontal className="w-3 h-3" /> Filters
          </button>
          <span className="text-xs font-mono text-neutral-500">{filtered.length} results</span>
        </div>

        <div className="flex gap-12">

          {/* ── Desktop sidebar ── */}
          <div className="hidden lg:block w-[280px] flex-shrink-0">
            <div className="sticky top-28">
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 border-b border-white pb-4">
                Refine Search
              </h3>
              <FilterContent />
            </div>
          </div>

          {/* ── Crew grid ── */}
          <div className="flex-grow min-w-0">

            {/* Sort controls */}
            <div className="hidden lg:flex justify-between items-center mb-8 pb-4 border-b border-white/5">
              <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest">
                {filtered.length} creator{filtered.length !== 1 ? 's' : ''} available
              </span>
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="bg-transparent text-xs font-bold uppercase tracking-widest border-none outline-none cursor-pointer hover:text-neutral-400"
                >
                  <option value="recommended">Recommended</option>
                  <option value="newest">Newest</option>
                  <option value="rateAsc">Rate: Low to High</option>
                  <option value="rateDesc">Rate: High to Low</option>
                  <option value="experience">Most Experienced</option>
                </select>
              </div>
            </div>

            {crew.length === 0 ? (
              <div className="py-32 text-center border border-dashed border-white/10">
                <p className="text-neutral-500 font-mono text-sm uppercase tracking-widest">
                  No crew members available yet.
                </p>
                <Link
                  href="/smart-rentals"
                  className="mt-4 inline-block text-xs font-mono uppercase tracking-widest border-b border-white pb-0.5 hover:opacity-50 transition-opacity"
                >
                  &larr; Browse all categories
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center border border-dashed border-white/10">
                <p className="text-neutral-500 font-mono text-sm uppercase tracking-widest">
                  No crew members match your criteria.
                </p>
                <button onClick={clearFilters} className="mt-4 text-xs font-bold underline">
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filtered.map((member) => (
                  <CrewCard key={member.id} crew={member} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile filter modal ── */}
      <AnimatePresence>
        {mobileFiltersOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-[#050505] lg:hidden flex flex-col"
          >
            <div className="flex justify-between items-center p-6 border-b border-white/10">
              <h2 className="text-lg font-display font-bold uppercase">Filters</h2>
              <button onClick={() => setMobileFiltersOpen(false)}>
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-grow overflow-y-auto p-6">
              <FilterContent />
            </div>
            <div className="p-6 border-t border-white/10 bg-[#080808]">
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full bg-[#D4A843] text-black py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                Show {filtered.length} Result{filtered.length !== 1 ? 's' : ''}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
