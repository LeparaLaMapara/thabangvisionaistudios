'use client';

import { useState, useMemo, useEffect, useCallback, useId, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, SlidersHorizontal, X, Check, ArrowRight, Users, Star, ShieldCheck, RotateCcw } from 'lucide-react';
import { formatRand } from '@/lib/format/money';
import { cityPageHeading, collectionPointWithCity } from '@/lib/rental/collection-point';
import { isOnSiteCategory, specEntries } from '@/lib/rental/on-site';
import { categoryLabel } from '@/lib/content/tags';
import type { RentalListItem } from '@/lib/supabase/queries/smartRentals';
import { PLAN, STUDIO } from '@/lib/constants';
import { useFocusTrap } from '@/components/ui/useFocusTrap';

// ─── Cloudinary thumbnail helper ──────────────────────────────────────────────
// Rewrites a Cloudinary URL to request a smaller, optimised thumbnail.
function cloudinaryThumb(url: string, width = 600): string {
  // Matches .../upload/v1234/... and inserts transforms after /upload/
  return url.replace(
    /\/upload\/(?:v\d+\/)?/,
    `/upload/w_${width},c_fill,f_auto,q_auto/`,
  );
}

// ─── Image shimmer skeleton ───────────────────────────────────────────────────
function ImageSkeleton(): React.ReactElement {
  return (
    <div className="absolute inset-0 bg-neutral-900 animate-pulse" aria-hidden="true">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]" />
    </div>
  );
}

// ─── Category label: one source (lib/content/tags) ───────────────────────────

const getCategoryLabel = categoryLabel;

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
  const panelId = useId();
  return (
    <div className="border-b border-white/10 py-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full min-h-[44px] justify-between items-center group"
      >
        <span className="text-xs font-bold uppercase tracking-widest text-white group-hover:text-neutral-400 transition-colors">
          {title}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 text-neutral-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Accessible check / radio row ─────────────────────────────────────────────
// The real input stays in the accessibility tree (sr-only, not display:none),
// so it can be tabbed to and toggled with Space; the styled box beside it
// shows a gold ring when the input has keyboard focus.

const OPTION_TEXT = 'text-xs font-mono text-neutral-400 group-hover:text-white peer-checked:text-white uppercase';
const FOCUS_RING = 'peer-focus-visible:ring-2 peer-focus-visible:ring-[#D4A843] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#050505]';

function OptionRow({
  type,
  name,
  label,
  checked,
  onChange,
}: {
  type: 'checkbox' | 'radio';
  name?: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const round = type === 'radio';
  return (
    <label className="flex items-center gap-3 min-h-[44px] cursor-pointer group">
      <input
        type={type}
        name={name}
        className="peer sr-only"
        checked={checked}
        onChange={onChange}
      />
      <span
        aria-hidden="true"
        className={`w-4 h-4 border flex items-center justify-center transition-colors flex-shrink-0 ${round ? 'rounded-full' : ''} ${FOCUS_RING} ${
          checked ? 'bg-[#D4A843] border-[#D4A843]' : 'border-neutral-400'
        }`}
      >
        {checked && (round
          ? <span className="w-1.5 h-1.5 rounded-full bg-black" />
          : <Check className="w-3 h-3 text-black" />)}
      </span>
      <span className={OPTION_TEXT}>{label}</span>
    </label>
  );
}

// ─── Rental card ─────────────────────────────────────────────────────────────

function RentalCard({ rental, category }: { rental: RentalListItem; category: string }) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const onLoad = useCallback(() => setImageState('loaded'), []);
  // A broken image used to leave the card on a pulsing skeleton forever.
  const onError = useCallback(() => setImageState('failed'), []);

  const extra = rental as RentalListItem & { is_verified?: boolean };

  // Top 3 features used as spec chips; fall back to metadata keys
  const specs = useMemo(() => {
    if (rental.features && rental.features.length > 0) return rental.features.slice(0, 3);
    if (rental.metadata) return specEntries(rental.metadata).map(([key]) => key).slice(0, 3);
    return [];
  }, [rental]);

  const firstImage = rental.gallery && rental.gallery.length > 0 ? rental.gallery[0].url : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group relative bg-[#0A0A0B] border border-white/5 hover:border-white/20 transition-all duration-300 flex flex-col min-w-0"
    >
      {/* Status badges */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-1.5">
        {!rental.is_available && (
          <span className="bg-red-700 text-white text-xs font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            Unavailable
          </span>
        )}
        {/* No "Studio" badge: all gear is ours, so it told the visitor nothing.
            A community listing, when one exists, still says so. */}
        {rental.owner_type === 'community' && (
          <span className="flex items-center gap-1 bg-violet-700 text-white text-xs font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <Users className="w-2.5 h-2.5" aria-hidden="true" />
            Community
          </span>
        )}
        {Boolean(extra.is_verified) && (
          <span className="flex items-center gap-1 bg-emerald-700 text-white text-xs font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <ShieldCheck className="w-2.5 h-2.5" aria-hidden="true" />
            Verified
          </span>
        )}
        {rental.is_featured && (
          <span className="flex items-center gap-1 bg-[#D4A843] text-black text-xs font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <Star className="w-2.5 h-2.5" aria-hidden="true" />
            Featured
          </span>
        )}
      </div>

      {/* No "Available" badge here: availability depends on dates, which are
          chosen on the item page. */}

      {/* Preview image: first gallery image */}
      <div className="relative aspect-square overflow-hidden bg-neutral-900">
        {firstImage && imageState !== 'failed' ? (
          <>
            {imageState === 'loading' && <ImageSkeleton />}
            <Image
              src={cloudinaryThumb(firstImage)}
              alt={rental.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className={`object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 scale-95 group-hover:scale-105 transition-all duration-700 ease-out ${
                imageState === 'loaded' ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={onLoad}
              onError={onError}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
              No image
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 flex-grow flex flex-col justify-between min-w-0">
        <div>
          {rental.brand ? (
            <div className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">
              {rental.brand}
            </div>
          ) : rental.owner_type === 'community' && rental.metadata?.location ? (
            <div className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">
              {rental.metadata.location}
            </div>
          ) : null}
          <h3 className="text-lg font-display font-medium text-white uppercase leading-tight mb-3 group-hover:underline decoration-1 underline-offset-4 break-words">
            {rental.title}
          </h3>
          {rental.model && (
            <p className="text-xs font-mono text-neutral-400 mb-3 -mt-2">{rental.model}</p>
          )}
          {rental.owner_type === 'community' && rental.metadata?.display_name && (
            <p className="text-xs font-mono text-violet-400 mb-2 -mt-1">
              Listed by {rental.metadata.display_name}
            </p>
          )}

          {specs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {specs.map((spec, i) => (
                <span
                  key={i}
                  className="text-xs font-mono text-neutral-400 border border-white/10 px-1.5 py-0.5 bg-white/5 uppercase break-all"
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
              <span className="text-sm font-bold text-white">
                {formatRand(rental.price_per_day)}
              </span>
              <span className="text-xs text-neutral-400 mb-0.5">a day</span>
            </div>
          ) : (
            <p className="text-xs font-mono text-neutral-400 mb-4 uppercase tracking-widest">
              Contact for pricing
            </p>
          )}

          {rental.is_available ? (
            <Link
              href={`/rentals/${category}/${rental.slug}`}
              aria-label={`View details: ${rental.title}`}
              className="w-full min-h-[44px] py-3 text-xs font-mono font-bold uppercase tracking-widest transition-all relative overflow-hidden group/btn bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 flex items-center justify-center gap-2"
            >
              View Details
              <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" aria-hidden="true" />
            </Link>
          ) : (
            <div className="w-full py-3 text-xs font-mono font-bold uppercase tracking-widest bg-neutral-800 text-neutral-300 border border-transparent text-center">
              Unavailable
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

type SortKey = 'recommended' | 'newest' | 'name' | 'priceAsc' | 'priceDesc';

export default function RentalCategoryClient({
  rentals,
  category,
  locationName,
  loadFailed = false,
  hasMore = false,
}: {
  rentals: RentalListItem[];
  category: string;
  locationName?: string;
  /** The stock read failed: show a retry notice, not "nothing in this category". */
  loadFailed?: boolean;
  /** The list was capped; say so instead of silently dropping the rest. */
  hasMore?: boolean;
}) {
  const router = useRouter();

  // Derive filter options entirely from DB data, never static
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

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedBrands,    setSelectedBrands]    = useState<string[]>([]);
  const [selectedTypes,     setSelectedTypes]      = useState<string[]>([]);
  const [maxPrice,          setMaxPrice]           = useState<number>(maxCatalogPrice);
  const [onlyAvailable,     setOnlyAvailable]      = useState(false);
  const [sourceFilter,      setSourceFilter]       = useState<'all' | 'studio' | 'community'>('all');
  const [sortBy,            setSortBy]             = useState<SortKey>('recommended');

  const filterDialogRef = useRef<HTMLDivElement>(null);
  const filterTitleId = useId();
  const sortId = useId();
  const closeFilters = useCallback(() => setMobileFiltersOpen(false), []);
  // Focus into the sheet, keep Tab inside, Escape closes, page scroll locked,
  // focus back on the Filters button afterwards.
  useFocusTrap(filterDialogRef, { active: mobileFiltersOpen, onEscape: closeFilters });

  // Sync slider when catalog data changes (e.g. navigating between categories)
  useEffect(() => {
    setMaxPrice(maxCatalogPrice);
  }, [maxCatalogPrice]);

  const hasCommunity = useMemo(() => rentals.some(r => r.owner_type === 'community'), [rentals]);

  // Reset filters when category changes
  useEffect(() => {
    setSelectedBrands([]);
    setSelectedTypes([]);
    setMaxPrice(maxCatalogPrice);
    setOnlyAvailable(false);
    setSourceFilter('all');
    setSortBy('recommended');
  }, [category, maxCatalogPrice]);

  const filtered = useMemo(() => {
    return rentals
      .filter(r => {
        if (selectedBrands.length > 0 && !selectedBrands.includes(r.brand ?? '')) return false;
        if (selectedTypes.length > 0 && !selectedTypes.includes(r.sub_category ?? '')) return false;
        if (maxPrice > 0 && (r.price_per_day ?? 0) > maxPrice) return false;
        if (onlyAvailable && !r.is_available) return false;
        if (sourceFilter !== 'all' && (r.owner_type ?? 'studio') !== sourceFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'recommended') return (b.ranking_score ?? 0) - (a.ranking_score ?? 0);
        if (sortBy === 'priceAsc')  return (a.price_per_day ?? 0) - (b.price_per_day ?? 0);
        if (sortBy === 'priceDesc') return (b.price_per_day ?? 0) - (a.price_per_day ?? 0);
        if (sortBy === 'name')      return a.title.localeCompare(b.title);
        // Newest: sort by created_at DESC
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [rentals, selectedBrands, selectedTypes, maxPrice, onlyAvailable, sourceFilter, sortBy]);

  const clearFilters = () => {
    setSelectedBrands([]);
    setSelectedTypes([]);
    setMaxPrice(maxCatalogPrice);
    setOnlyAvailable(false);
    setSourceFilter('all');
  };

  const categoryLabel = getCategoryLabel(category);
  // City pages: the gear is collected in one place or delivered, never "in" that
  // city (C7). A studio is used where it is, so it keeps "Studios in <city>".
  const cityHeading = locationName
    ? isOnSiteCategory(category)
      ? { title: `${categoryLabel} in ${locationName}`, rest: '' }
      : cityPageHeading(categoryLabel, locationName)
    : null;

  // ── Filter panel (shared between desktop sidebar + mobile sheet) ──────────
  // A plain render function, not a component declared inside this one: a
  // component created during render is a new type every render, so React
  // remounted the whole panel on each state change -- the price slider lost
  // its drag after the first step and keyboard focus was thrown away.
  // `scope` keeps radio-group names apart between the two copies.
  const renderFilters = (scope: 'desktop' | 'mobile'): React.ReactElement => (
    <div className="space-y-1">
      {uniqueBrands.length > 0 && (
        <FilterSection title="Brand">
          {uniqueBrands.map(brand => (
            <OptionRow
              key={brand}
              type="checkbox"
              label={brand}
              checked={selectedBrands.includes(brand)}
              onChange={() =>
                setSelectedBrands(prev =>
                  prev.includes(brand) ? prev.filter(b => b !== brand) : [...prev, brand],
                )
              }
            />
          ))}
        </FilterSection>
      )}

      {uniqueTypes.length > 0 && (
        <FilterSection title="Product Type">
          {uniqueTypes.map(type => (
            <OptionRow
              key={type}
              type="checkbox"
              label={type}
              checked={selectedTypes.includes(type)}
              onChange={() =>
                setSelectedTypes(prev =>
                  prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type],
                )
              }
            />
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
              step={1}
              value={maxPrice}
              onChange={e => setMaxPrice(Number(e.target.value))}
              aria-label="Maximum daily rate"
              aria-valuetext={formatRand(maxPrice)}
              className="w-full h-11 bg-transparent cursor-pointer accent-[#D4A843]"
            />
            <div className="flex justify-between mt-2 font-mono text-xs text-neutral-400">
              <span>0</span>
              <span className="text-[#D4A843] font-bold">
                Max: {formatRand(maxPrice)}
              </span>
            </div>
          </div>
        </FilterSection>
      )}

      <FilterSection title="Availability">
        <label className="flex items-center justify-between min-h-[44px] cursor-pointer group">
          <input
            type="checkbox"
            role="switch"
            aria-checked={onlyAvailable}
            className="peer sr-only"
            checked={onlyAvailable}
            onChange={() => setOnlyAvailable(v => !v)}
          />
          <span className={OPTION_TEXT}>
            Available Only
          </span>
          <span
            aria-hidden="true"
            className={`w-10 h-5 rounded-full relative transition-colors ${FOCUS_RING} ${
              onlyAvailable ? 'bg-[#D4A843]' : 'bg-neutral-800'
            }`}
          >
            <span
              className={`absolute top-1 w-3 h-3 rounded-full transition-all ${
                onlyAvailable ? 'left-6 bg-black' : 'left-1 bg-neutral-400'
              }`}
            />
          </span>
        </label>
      </FilterSection>

      {hasCommunity && (
        <FilterSection title="Source">
          <div role="radiogroup" aria-label="Source">
            {(['all', 'studio', 'community'] as const).map(opt => (
              <OptionRow
                key={opt}
                type="radio"
                name={`source-${scope}`}
                label={opt === 'all' ? 'All Gear' : opt === 'studio' ? 'Studio Gear' : 'Community Gear'}
                checked={sourceFilter === opt}
                onChange={() => setSourceFilter(opt)}
              />
            ))}
          </div>
        </FilterSection>
      )}

      <div className="pt-6">
        <button
          type="button"
          onClick={clearFilters}
          className="min-h-[44px] text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors border-b border-transparent hover:border-white"
        >
          Clear All Filters
        </button>
      </div>
    </div>
  );

  // Rendered twice (phone toolbar and desktop bar), so each copy gets its own id.
  const renderSort = (scope: 'mobile' | 'desktop'): React.ReactElement => (
    <div className="flex items-center gap-3">
      <label htmlFor={`${sortId}-${scope}`} className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
        Sort
      </label>
      <select
        id={`${sortId}-${scope}`}
        value={sortBy}
        onChange={e => setSortBy(e.target.value as SortKey)}
        className="min-h-[44px] bg-[#050505] text-white text-base md:text-xs font-bold uppercase tracking-widest border border-white/20 px-2 cursor-pointer hover:border-white/40"
      >
        <option value="recommended">Recommended</option>
        <option value="newest">Newest</option>
        <option value="name">Name (A–Z)</option>
        <option value="priceAsc">Price: Low to High</option>
        <option value="priceDesc">Price: High to Low</option>
      </select>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-white pt-20">

      {/* ── Breadcrumbs + header ── */}
      <div className="bg-[#080808] border-b border-white/5 py-12">
        <div className="container mx-auto px-6">
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400">
              <li><Link href="/" className="inline-flex min-h-[44px] items-center hover:text-white">Home</Link></li>
              <li aria-hidden="true">/</li>
              <li><Link href="/rentals" className="inline-flex min-h-[44px] items-center hover:text-white">Rentals</Link></li>
              <li aria-hidden="true">/</li>
              <li className="text-white" aria-current={locationName ? undefined : 'page'}>{categoryLabel}</li>
              {locationName && (
                <>
                  <li aria-hidden="true">/</li>
                  <li className="text-white" aria-current="page">{locationName}</li>
                </>
              )}
            </ol>
          </nav>
          {cityHeading ? (
            <h1 className="text-4xl md:text-5xl font-display font-medium tracking-tight break-words">
              {cityHeading.title}
              {cityHeading.rest && (
                <>
                  ,{' '}<span className="text-neutral-400">{cityHeading.rest}</span>
                </>
              )}
            </h1>
          ) : (
            <h1 className="text-4xl md:text-5xl font-display font-medium uppercase tracking-tight break-words">{categoryLabel}</h1>
          )}
          {locationName && (
            <p className="mt-3 text-sm text-neutral-400 font-light">
              Collected at {collectionPointWithCity()}. After your first hire we can also deliver within {STUDIO.fulfilment.delivery.maxRadiusKm} km.
            </p>
          )}
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">

        {/* ── Mobile filter toggle + sort ── */}
        <div className="lg:hidden mb-6 flex flex-wrap gap-3 justify-between items-center">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={mobileFiltersOpen}
            className="flex items-center gap-2 min-h-[44px] text-xs font-mono font-bold uppercase tracking-widest border border-white px-4"
          >
            <SlidersHorizontal className="w-3 h-3" aria-hidden="true" /> Filters
          </button>
          {renderSort('mobile')}
          <span className="w-full text-xs font-mono text-neutral-400" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="flex gap-12">

          {/* ── Desktop sidebar ── */}
          <div className="hidden lg:block w-[280px] flex-shrink-0">
            <div className="sticky top-28">
              <h2 className="text-sm font-bold uppercase tracking-widest mb-6 border-b border-white pb-4">
                Refine Search
              </h2>
              {renderFilters('desktop')}
            </div>
          </div>

          {/* ── Product grid ── */}
          <div className="flex-grow min-w-0">

            {/* Sort controls */}
            <div className="hidden lg:flex justify-between items-center mb-8 pb-4 border-b border-white/5">
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest" aria-live="polite">
                {filtered.length} product{filtered.length !== 1 ? 's' : ''} found
              </span>
              {renderSort('desktop')}
            </div>

            <h2 className="sr-only">Equipment</h2>

            {loadFailed ? (
              /* The stock could not be read. Say so -- this is not an empty category. */
              <div role="alert" className="py-20 px-4 text-center border border-dashed border-[#D4A843]/30">
                <p className="text-neutral-300 font-mono text-sm uppercase tracking-widest">
                  We couldn&apos;t load this equipment just now.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => router.refresh()}
                    className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    Try again
                  </button>
                  <Link
                    href="/rentals"
                    className="inline-flex items-center min-h-[44px] px-5 border border-white/30 text-xs font-mono uppercase tracking-widest hover:border-white transition-colors"
                  >
                    All categories
                  </Link>
                </div>
              </div>
            ) : rentals.length === 0 ? (
              /* Category exists in URL but no rentals published yet */
              <div className="py-32 text-center border border-dashed border-white/10">
                <p className="text-neutral-400 font-mono text-sm uppercase tracking-widest">
                  No equipment published in this category yet.
                </p>
                <Link
                  href="/rentals"
                  className="mt-4 inline-flex min-h-[44px] items-center text-xs font-mono uppercase tracking-widest border-b border-white hover:opacity-50 transition-opacity"
                >
                  ← Browse all categories
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              /* Filters produced no results */
              <div className="py-20 text-center border border-dashed border-white/10">
                <p className="text-neutral-400 font-mono text-sm uppercase tracking-widest">
                  No equipment matches your criteria.
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 min-h-[44px] px-4 text-xs font-bold underline"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filtered.map(rental => (
                    <RentalCard key={rental.id} rental={rental} category={category} />
                  ))}
                </div>
                {hasMore && (
                  <p className="mt-8 text-xs font-mono text-neutral-400 uppercase tracking-widest text-center">
                    Showing the top {rentals.length} items. Use the filters, or say what you need on{' '}
                    <Link href={PLAN.href} className="text-[#D4A843] underline underline-offset-2">{PLAN.label}</Link>.
                  </p>
                )}
              </>
            )}

          </div>
        </div>
      </div>

      {/* ── Mobile filter sheet ── */}
      {/* z-[400]: above the fixed header (z-[300]), which used to cover the
          sheet's title bar and close button. */}
      <AnimatePresence>
        {mobileFiltersOpen && (
          <motion.div
            ref={filterDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={filterTitleId}
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[400] bg-[#050505] lg:hidden flex flex-col h-dvh"
          >
            <div className="flex justify-between items-center px-6 py-3 border-b border-white/10">
              <h2 id={filterTitleId} className="text-lg font-display font-bold uppercase">Filters</h2>
              <button
                type="button"
                onClick={closeFilters}
                aria-label="Close filters"
                className="w-11 h-11 -mr-2 flex items-center justify-center"
              >
                <X className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-grow overflow-y-auto overscroll-contain px-6 pb-6">
              {renderFilters('mobile')}
            </div>
            <div className="p-6 border-t border-white/10 bg-[#080808]">
              <button
                type="button"
                onClick={closeFilters}
                className="w-full min-h-[44px] bg-[#D4A843] text-black py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
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
