'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, SlidersHorizontal, X, Check, ArrowRight } from 'lucide-react';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';

// ─── Category label map ───────────────────────────────────────────────────────
// Owned locally — no data.ts dependency.

const CATEGORY_LABELS: Record<string, string> = {
  'cameras-optics':        'Cameras & Optics',
  'lighting-power':        'Lighting & Power',
  'audio':                 'Audio',
  'grip-motion':           'Grip & Motion',
  'data-storage':          'Data & Storage',
  'crew-services':         'Crew Services',
  'specialized-solutions': 'Specialized Solutions',
};

function getCategoryLabel(slug: string): string {
  return (
    CATEGORY_LABELS[slug] ??
    slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
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
    <div className="border-b border-black/10 dark:border-white/10 py-5">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full justify-between items-center group"
      >
        <span className="text-xs font-bold uppercase tracking-widest text-black dark:text-white group-hover:text-neutral-600 dark:group-hover:text-neutral-400 transition-colors">
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

// ─── Rental card ─────────────────────────────────────────────────────────────

function RentalCard({ rental, category }: { rental: SmartRental; category: string }) {
  // Top 3 features used as spec chips; fall back to metadata keys
  const specs = useMemo(() => {
    if (rental.features && rental.features.length > 0) return rental.features.slice(0, 3);
    if (rental.metadata) return Object.keys(rental.metadata).slice(0, 3);
    return [];
  }, [rental]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group relative bg-white dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 flex flex-col"
    >
      {/* Status badges */}
      <div className="absolute top-3 left-3 z-20 flex gap-2">
        {!rental.is_available && (
          <span className="bg-red-500 text-white text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            Unavailable
          </span>
        )}
      </div>

      {rental.is_available && (
        <div className="absolute top-3 right-3 z-20">
          <div className="flex items-center gap-1.5 bg-green-500/10 backdrop-blur-md px-2 py-1 rounded-full border border-green-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[9px] font-mono font-bold text-green-600 dark:text-green-400 uppercase tracking-widest">
              Available
            </span>
          </div>
        </div>
      )}

      {/* Thumbnail */}
      <div className="relative aspect-square overflow-hidden bg-neutral-100 dark:bg-neutral-900">
        {rental.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rental.thumbnail_url}
            alt={rental.title}
            className="w-full h-full object-cover grayscale group-hover:grayscale-0 scale-95 group-hover:scale-105 transition-all duration-700 ease-out"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
              No image
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 flex-grow flex flex-col justify-between">
        <div>
          {rental.brand && (
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-1">
              {rental.brand}
            </div>
          )}
          <h3 className="text-lg font-display font-medium text-black dark:text-white uppercase leading-tight mb-3 group-hover:underline decoration-1 underline-offset-4">
            {rental.title}
          </h3>
          {rental.model && (
            <p className="text-[10px] font-mono text-neutral-500 mb-3 -mt-2">{rental.model}</p>
          )}

          {specs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {specs.map((spec, i) => (
                <span
                  key={i}
                  className="text-[9px] font-mono text-neutral-600 dark:text-neutral-400 border border-black/10 dark:border-white/10 px-1.5 py-0.5 bg-neutral-50 dark:bg-white/5 uppercase"
                >
                  {spec}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          {rental.price_per_day != null ? (
            <div className="flex items-end gap-1 mb-4">
              <span className="text-sm font-bold text-black dark:text-white">
                {rental.currency} {rental.price_per_day.toLocaleString()}
              </span>
              <span className="text-[10px] text-neutral-500 mb-0.5">/ day</span>
            </div>
          ) : (
            <p className="text-[10px] font-mono text-neutral-500 mb-4 uppercase tracking-widest">
              Contact for pricing
            </p>
          )}

          {rental.is_available ? (
            <Link
              href={`/smart-rentals/${category}/${rental.slug}`}
              className="w-full py-3 text-[10px] font-mono font-bold uppercase tracking-widest transition-all relative overflow-hidden group/btn bg-black text-white dark:bg-white dark:text-black border border-black dark:border-white hover:bg-neutral-800 dark:hover:bg-neutral-200 flex items-center justify-center gap-2"
            >
              View Details
              <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
            </Link>
          ) : (
            <div className="w-full py-3 text-[10px] font-mono font-bold uppercase tracking-widest bg-neutral-200 dark:bg-neutral-800 text-neutral-400 border border-transparent text-center">
              Unavailable
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

type SortKey = 'newest' | 'name' | 'priceAsc' | 'priceDesc';

export default function RentalCategoryClient({
  rentals,
  category,
}: {
  rentals: SmartRental[];
  category: string;
}) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedBrands,    setSelectedBrands]    = useState<string[]>([]);
  const [selectedTypes,     setSelectedTypes]      = useState<string[]>([]);
  const [maxPrice,          setMaxPrice]           = useState<number>(0);
  const [onlyAvailable,     setOnlyAvailable]      = useState(false);
  const [sortBy,            setSortBy]             = useState<SortKey>('newest');

  // Derive filter options entirely from DB data — never static
  const uniqueBrands = useMemo(
    () => Array.from(new Set(rentals.map(r => r.brand).filter(Boolean) as string[])).sort(),
    [rentals],
  );

  const uniqueTypes = useMemo(
    () => Array.from(new Set(rentals.map(r => r.sub_category).filter(Boolean) as string[])).sort(),
    [rentals],
  );

  const maxCatalogPrice = useMemo(
    () => Math.max(0, ...rentals.map(r => r.price_per_day ?? 0)),
    [rentals],
  );

  // Initialise slider to the real max price when data loads
  useEffect(() => {
    setMaxPrice(maxCatalogPrice);
  }, [maxCatalogPrice]);

  // Reset filters when category changes
  useEffect(() => {
    setSelectedBrands([]);
    setSelectedTypes([]);
    setOnlyAvailable(false);
    setSortBy('newest');
  }, [category]);

  const filtered = useMemo(() => {
    return rentals
      .filter(r => {
        if (selectedBrands.length > 0 && !selectedBrands.includes(r.brand ?? '')) return false;
        if (selectedTypes.length > 0 && !selectedTypes.includes(r.sub_category ?? '')) return false;
        if (maxPrice > 0 && (r.price_per_day ?? 0) > maxPrice) return false;
        if (onlyAvailable && !r.is_available) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'priceAsc')  return (a.price_per_day ?? 0) - (b.price_per_day ?? 0);
        if (sortBy === 'priceDesc') return (b.price_per_day ?? 0) - (a.price_per_day ?? 0);
        if (sortBy === 'name')      return a.title.localeCompare(b.title);
        // newest (default) — already ordered by created_at DESC from DB
        return 0;
      });
  }, [rentals, selectedBrands, selectedTypes, maxPrice, onlyAvailable, sortBy]);

  const clearFilters = () => {
    setSelectedBrands([]);
    setSelectedTypes([]);
    setMaxPrice(maxCatalogPrice);
    setOnlyAvailable(false);
  };

  const categoryLabel = getCategoryLabel(category);

  // ── Filter panel (shared between desktop sidebar + mobile modal) ──────────
  const FilterContent = () => (
    <div className="space-y-1">
      {uniqueBrands.length > 0 && (
        <FilterSection title="Brand">
          {uniqueBrands.map(brand => (
            <label key={brand} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-4 h-4 border flex items-center justify-center transition-colors flex-shrink-0 ${
                  selectedBrands.includes(brand)
                    ? 'bg-black border-black dark:bg-white dark:border-white'
                    : 'border-neutral-400'
                }`}
              >
                {selectedBrands.includes(brand) && (
                  <Check className="w-3 h-3 text-white dark:text-black" />
                )}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={selectedBrands.includes(brand)}
                onChange={() =>
                  setSelectedBrands(prev =>
                    prev.includes(brand) ? prev.filter(b => b !== brand) : [...prev, brand],
                  )
                }
              />
              <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white uppercase">
                {brand}
              </span>
            </label>
          ))}
        </FilterSection>
      )}

      {uniqueTypes.length > 0 && (
        <FilterSection title="Product Type">
          {uniqueTypes.map(type => (
            <label key={type} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-4 h-4 border flex items-center justify-center transition-colors flex-shrink-0 ${
                  selectedTypes.includes(type)
                    ? 'bg-black border-black dark:bg-white dark:border-white'
                    : 'border-neutral-400'
                }`}
              >
                {selectedTypes.includes(type) && (
                  <Check className="w-3 h-3 text-white dark:text-black" />
                )}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={selectedTypes.includes(type)}
                onChange={() =>
                  setSelectedTypes(prev =>
                    prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type],
                  )
                }
              />
              <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white uppercase">
                {type}
              </span>
            </label>
          ))}
        </FilterSection>
      )}

      {maxCatalogPrice > 0 && (
        <FilterSection title="Daily Rate">
          <div className="px-1 pt-2">
            <input
              type="range"
              min={0}
              max={maxCatalogPrice}
              step={Math.max(1, Math.round(maxCatalogPrice / 100))}
              value={maxPrice}
              onChange={e => setMaxPrice(Number(e.target.value))}
              className="w-full h-1 bg-neutral-200 dark:bg-neutral-800 appearance-none cursor-pointer accent-black dark:accent-white rounded-lg"
            />
            <div className="flex justify-between mt-4 font-mono text-xs text-neutral-500">
              <span>0</span>
              <span className="text-black dark:text-white font-bold">
                Max: {rentals[0]?.currency ?? 'ZAR'} {maxPrice.toLocaleString()}
              </span>
            </div>
          </div>
        </FilterSection>
      )}

      <FilterSection title="Availability">
        <label className="flex items-center justify-between cursor-pointer group">
          <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white uppercase">
            Available Only
          </span>
          <div
            className={`w-10 h-5 rounded-full relative transition-colors ${
              onlyAvailable ? 'bg-black dark:bg-white' : 'bg-neutral-200 dark:bg-neutral-800'
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={onlyAvailable}
              onChange={() => setOnlyAvailable(v => !v)}
            />
            <div
              className={`absolute top-1 w-3 h-3 rounded-full bg-white dark:bg-black transition-all ${
                onlyAvailable ? 'left-6' : 'left-1'
              }`}
            />
          </div>
        </label>
      </FilterSection>

      <div className="pt-8">
        <button
          onClick={clearFilters}
          className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-black dark:hover:text-white transition-colors border-b border-transparent hover:border-black dark:hover:border-white pb-0.5"
        >
          Clear All Filters
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] text-black dark:text-white pt-20 transition-colors duration-500">

      {/* ── Breadcrumbs + header ── */}
      <div className="bg-neutral-50 dark:bg-[#080808] border-b border-black/5 dark:border-white/5 py-12">
        <div className="container mx-auto px-6">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-6">
            <Link href="/" className="hover:text-black dark:hover:text-white">Home</Link>
            <span>/</span>
            <Link href="/smart-rentals" className="hover:text-black dark:hover:text-white">Smart Rentals</Link>
            <span>/</span>
            <span className="text-black dark:text-white">{categoryLabel}</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-medium uppercase tracking-tight">
            {categoryLabel}
          </h1>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">

        {/* ── Mobile filter toggle ── */}
        <div className="lg:hidden mb-6 flex justify-between items-center">
          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest border border-black dark:border-white px-4 py-2"
          >
            <SlidersHorizontal className="w-3 h-3" /> Filters
          </button>
          <span className="text-xs font-mono text-neutral-500">{filtered.length} results</span>
        </div>

        <div className="flex gap-12">

          {/* ── Desktop sidebar ── */}
          <div className="hidden lg:block w-[280px] flex-shrink-0">
            <div className="sticky top-28">
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 border-b border-black dark:border-white pb-4">
                Refine Search
              </h3>
              <FilterContent />
            </div>
          </div>

          {/* ── Product grid ── */}
          <div className="flex-grow min-w-0">

            {/* Sort controls */}
            <div className="hidden lg:flex justify-between items-center mb-8 pb-4 border-b border-black/5 dark:border-white/5">
              <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest">
                {filtered.length} product{filtered.length !== 1 ? 's' : ''} found
              </span>
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest">Sort:</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortKey)}
                  className="bg-transparent text-xs font-bold uppercase tracking-widest border-none outline-none cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-400"
                >
                  <option value="newest">Newest</option>
                  <option value="name">Name (A–Z)</option>
                  <option value="priceAsc">Price (Low → High)</option>
                  <option value="priceDesc">Price (High → Low)</option>
                </select>
              </div>
            </div>

            {rentals.length === 0 ? (
              /* Category exists in URL but no rentals published yet */
              <div className="py-32 text-center border border-dashed border-black/10 dark:border-white/10">
                <p className="text-neutral-500 font-mono text-sm uppercase tracking-widest">
                  No equipment published in this category yet.
                </p>
                <Link
                  href="/smart-rentals"
                  className="mt-4 inline-block text-xs font-mono uppercase tracking-widest border-b border-black dark:border-white pb-0.5 hover:opacity-50 transition-opacity"
                >
                  ← Browse all categories
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              /* Filters produced no results */
              <div className="py-20 text-center border border-dashed border-black/10 dark:border-white/10">
                <p className="text-neutral-500 font-mono text-sm uppercase tracking-widest">
                  No equipment matches your criteria.
                </p>
                <button
                  onClick={clearFilters}
                  className="mt-4 text-xs font-bold underline"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filtered.map(rental => (
                  <RentalCard key={rental.id} rental={rental} category={category} />
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
            className="fixed inset-0 z-[60] bg-white dark:bg-[#050505] lg:hidden flex flex-col"
          >
            <div className="flex justify-between items-center p-6 border-b border-black/10 dark:border-white/10">
              <h2 className="text-lg font-display font-bold uppercase">Filters</h2>
              <button onClick={() => setMobileFiltersOpen(false)}>
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-grow overflow-y-auto p-6">
              <FilterContent />
            </div>
            <div className="p-6 border-t border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-[#080808]">
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full bg-black text-white dark:bg-white dark:text-black py-4 text-xs font-mono font-bold uppercase tracking-widest"
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
