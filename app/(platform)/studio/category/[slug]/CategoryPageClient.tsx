'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight, ChevronRight, ChevronDown, Play, Star,
  SlidersHorizontal, X, Check,
} from 'lucide-react';
import type { ProductionCategory, ProductionPackage } from '@/types/production';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';
import type { CrewMember } from '@/lib/supabase/queries/crew';
import { calculatePackagePrice, formatZAR } from '@/lib/productions/pricing';
import { PRODUCTION_SERVICES } from '@/lib/constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cloudinaryThumb(url: string, width = 600): string {
  return url.replace(
    /\/upload\/(?:v\d+\/)?/,
    `/upload/w_${width},c_fill,f_auto,q_auto/`,
  );
}

function ImageSkeleton(): React.ReactElement {
  return (
    <div className="absolute inset-0 bg-neutral-900 animate-pulse">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]" />
    </div>
  );
}

function extractVideoId(url: string): string {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]{11})/,
  );
  return match?.[1] ?? url;
}

// ─── Filter Accordion ────────────────────────────────────────────────────────

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

// ─── Production Card (mirrors RentalCard) ────────────────────────────────────

function ProductionCard({ production }: { production: SmartProduction }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const onLoad = useCallback(() => setImageLoaded(true), []);

  const hasVideo = Boolean(production.video_url);
  const imageUrl = production.gallery?.[0]?.url ?? production.thumbnail_url;
  const imageCount = production.gallery?.length ?? 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group relative bg-[#0A0A0B] border border-white/5 hover:border-white/20 transition-all duration-300 flex flex-col"
    >
      {/* Badges */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-1.5">
        {production.is_featured && (
          <span className="flex items-center gap-1 bg-[#D4A843] text-black text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <Star className="w-2.5 h-2.5" />
            Featured
          </span>
        )}
        {hasVideo && (
          <span className="flex items-center gap-1 bg-white/10 backdrop-blur-md text-white text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <Play className="w-2.5 h-2.5" />
            Video
          </span>
        )}
      </div>

      {/* Image count badge */}
      {imageCount > 1 && (
        <div className="absolute top-3 right-3 z-20">
          <span className="bg-black/60 backdrop-blur-md text-white text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            {imageCount} photos
          </span>
        </div>
      )}

      {/* Preview image: aspect-square like rental cards */}
      <div className="relative aspect-square overflow-hidden bg-neutral-900">
        {imageUrl ? (
          <>
            {!imageLoaded && <ImageSkeleton />}
            <Image
              src={cloudinaryThumb(imageUrl)}
              alt={production.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className={`object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 scale-95 group-hover:scale-105 transition-all duration-700 ease-out ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={onLoad}
            />
          </>
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
          {production.sub_category && (
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-1">
              {production.sub_category}
            </div>
          )}
          <h3 className="text-lg font-display font-medium text-white uppercase leading-tight mb-2 group-hover:underline decoration-1 underline-offset-4">
            {production.title}
          </h3>
          {production.client && (
            <p className="text-[10px] font-mono text-neutral-500 mb-2 -mt-1">
              Client: {production.client}
            </p>
          )}
          {production.description && (
            <p className="text-xs text-neutral-400 line-clamp-2 mb-3">
              {production.description}
            </p>
          )}
          {production.tags && production.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {production.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] font-mono text-neutral-400 border border-white/10 px-1.5 py-0.5 bg-white/5 uppercase"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <Link
          href={`/studio/${production.slug}`}
          className="w-full py-3 text-[10px] font-mono font-bold uppercase tracking-widest transition-all bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 flex items-center justify-center gap-2"
        >
          View Photos &amp; Video
          <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
        </Link>
      </div>
    </motion.div>
  );
}

// ─── Package Card (with production preview image) ────────────────────────────

function PackageCard({
  pkg,
  previewImage,
  isFeatured,
  vatRate,
}: {
  pkg: ProductionPackage;
  previewImage: string | null;
  isFeatured: boolean;
  vatRate: number;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const onLoad = useCallback(() => setImageLoaded(true), []);
  const price = calculatePackagePrice(pkg);

  return (
    <div
      className={`relative flex flex-col border transition-colors ${
        isFeatured
          ? 'border-[#D4A843] bg-[#D4A843]/5'
          : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'
      }`}
    >
      {isFeatured && (
        <span className="absolute top-3 left-3 z-20 bg-[#D4A843] text-black text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
          Most Popular
        </span>
      )}

      {/* Preview image from matching production */}
      <div className="relative aspect-[16/9] overflow-hidden bg-neutral-900">
        {previewImage ? (
          <>
            {!imageLoaded && <ImageSkeleton />}
            <Image
              src={cloudinaryThumb(previewImage, 800)}
              alt={pkg.name}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className={`object-cover transition-all duration-500 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={onLoad}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-neutral-900">
            <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">
              Example work coming soon
            </span>
          </div>
        )}

        {/* Price overlay on image */}
        <div className="absolute bottom-3 left-4 z-10">
          <span className="text-2xl font-bold text-white font-mono">
            {formatZAR(price.total)}
          </span>
          <span className="block text-white/60 text-[10px] mt-0.5">
            incl. {vatRate}% VAT
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 flex-grow flex flex-col">
        <h4 className="text-lg font-semibold text-white">{pkg.name}</h4>
        <p className="text-neutral-400 text-sm mt-1 mb-4">{pkg.description}</p>

        <ul className="flex-1 space-y-2 mb-5">
          {pkg.deliverables.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-neutral-300">
              <span className="text-[#D4A843] mt-0.5 shrink-0">&#10003;</span>
              {item}
            </li>
          ))}
        </ul>

        <a
          href={`/ubunye-ai-studio?prompt=${encodeURIComponent(`I want to book the ${pkg.name} package under ${pkg.category}`)}`}
          className={`block w-full text-center py-3 text-[10px] font-mono font-bold uppercase tracking-widest transition-colors ${
            isFeatured
              ? 'bg-[#D4A843] text-black hover:bg-[#c49a3a]'
              : 'bg-neutral-800 text-white hover:bg-neutral-700'
          }`}
        >
          Book This Package
        </a>
      </div>
    </div>
  );
}

// ─── Creator Card ────────────────────────────────────────────────────────────

function CreatorCard({ creator, categorySlug }: { creator: CrewMember; categorySlug: string }) {
  const initials = (creator.display_name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Link
      href={`/studio/category/${categorySlug}/${creator.crew_slug ?? creator.id}`}
      className="group flex items-center gap-4 bg-[#0A0A0B] border border-white/5 hover:border-[#D4A843]/30 p-4 transition-colors"
    >
      <div className="relative w-12 h-12 rounded-full overflow-hidden bg-neutral-800 flex-shrink-0">
        {creator.avatar_url ? (
          <Image
            src={cloudinaryThumb(creator.avatar_url, 96)}
            alt={creator.display_name ?? 'Creator'}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs font-bold text-neutral-400">
            {initials}
          </div>
        )}
      </div>
      <div className="flex-grow min-w-0">
        <h4 className="text-sm font-bold text-white truncate group-hover:text-[#D4A843] transition-colors">
          {creator.display_name ?? 'Creator'}
        </h4>
        {creator.specializations.length > 0 && (
          <p className="text-[10px] font-mono text-neutral-500 truncate">
            {creator.specializations.slice(0, 3).join(' / ')}
          </p>
        )}
        {creator.hourly_rate != null && (
          <p className="text-[10px] font-mono text-[#D4A843] mt-0.5">
            From {formatZAR(creator.hourly_rate)}/hr
          </p>
        )}
      </div>
      <ArrowRight className="w-4 h-4 text-neutral-600 group-hover:text-[#D4A843] flex-shrink-0 transition-colors" />
    </Link>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface Props {
  category: ProductionCategory;
  packages: ProductionPackage[];
  productions: SmartProduction[];
  creators: CrewMember[];
  locationName?: string;
}

export default function CategoryPageClient({ category, packages, productions, creators, locationName }: Props) {
  const vatRate = PRODUCTION_SERVICES.billing.vatRate;

  // Sub-category filter
  const subCategories = useMemo(() => {
    const subs = new Set(
      productions.map((p) => p.sub_category).filter(Boolean) as string[],
    );
    return Array.from(subs).sort();
  }, [productions]);

  const [activeSubFilter, setActiveSubFilter] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [showPackages, setShowPackages] = useState(true);

  const filteredProductions = useMemo(() => {
    if (!activeSubFilter) return productions;
    return productions.filter((p) => p.sub_category === activeSubFilter);
  }, [productions, activeSubFilter]);

  // Map package → preview image from the first matching production
  const packagePreviewImages = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const pkg of packages) {
      // Find a production that could serve as preview for this package
      const match = productions.find(
        (p) => p.gallery && p.gallery.length > 0,
      );
      map[pkg.id] = match?.gallery?.[0]?.url ?? match?.thumbnail_url ?? null;
    }
    return map;
  }, [packages, productions]);

  // Video showreel
  const showreelProduction = useMemo(
    () => productions.find((p) => p.video_url),
    [productions],
  );

  const clearFilters = () => {
    setActiveSubFilter(null);
  };

  // ── Filter panel ──
  const filterContent = (
    <div className="space-y-1">
      {subCategories.length > 0 && (
        <FilterSection title="Type">
          {subCategories.map((sub) => (
            <label key={sub} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-4 h-4 border flex items-center justify-center transition-colors flex-shrink-0 ${
                  activeSubFilter === sub
                    ? 'bg-[#D4A843] border-[#D4A843]'
                    : 'border-neutral-400'
                }`}
              >
                {activeSubFilter === sub && <Check className="w-3 h-3 text-black" />}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={activeSubFilter === sub}
                onChange={() =>
                  setActiveSubFilter((prev) => (prev === sub ? null : sub))
                }
              />
              <span className="text-xs font-mono text-neutral-400 group-hover:text-white uppercase">
                {sub}
              </span>
            </label>
          ))}
        </FilterSection>
      )}

      <FilterSection title="View">
        <label className="flex items-center justify-between cursor-pointer group">
          <span className="text-xs font-mono text-neutral-400 group-hover:text-white uppercase">
            Show Packages
          </span>
          <div
            className={`w-10 h-5 rounded-full relative transition-colors ${
              showPackages ? 'bg-[#D4A843]' : 'bg-neutral-800'
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={showPackages}
              onChange={() => setShowPackages((v) => !v)}
            />
            <div
              className={`absolute top-1 w-3 h-3 rounded-full bg-black transition-all ${
                showPackages ? 'left-6' : 'left-1'
              }`}
            />
          </div>
        </label>
      </FilterSection>

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
            <Link href="/studio" className="hover:text-white">Studio</Link>
            <span>/</span>
            <Link href={`/studio/category/${category.slug}`} className="hover:text-white">{category.name}</Link>
            {locationName && (
              <>
                <span>/</span>
                <span className="text-white">{locationName}</span>
              </>
            )}
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-display font-medium uppercase tracking-tight mb-4"
          >
            {category.name}{locationName ? ` in ${locationName}` : ''}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-neutral-400 max-w-2xl text-sm md:text-base font-light leading-relaxed mb-4"
          >
            {category.description}
          </motion.p>

          {/* Sub-types */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex flex-wrap gap-2 mb-4"
          >
            {category.subTypes.map((sub) => (
              <span
                key={sub}
                className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider bg-neutral-900 text-neutral-400 border border-white/5"
              >
                {sub}
              </span>
            ))}
          </motion.div>

          <div className="text-xs font-mono text-[#D4A843]">
            From {formatZAR(category.startingRate)} per {category.startingUnit}
          </div>
        </div>
      </div>

      {/* ── Video Showreel ── */}
      {showreelProduction && showreelProduction.video_url && (
        <div className="container mx-auto px-6 py-12 border-b border-white/5">
          <h2 className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-6">
            Showreel
          </h2>
          <div className="relative aspect-video max-w-4xl bg-neutral-900 overflow-hidden">
            {showreelProduction.video_provider === 'youtube' ? (
              <iframe
                src={`https://www.youtube.com/embed/${extractVideoId(showreelProduction.video_url)}?rel=0`}
                title={`${category.name} Showreel`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video
                src={showreelProduction.video_url}
                controls
                className="w-full h-full object-cover"
                poster={showreelProduction.thumbnail_url ?? undefined}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Main content: sidebar + grid (mirrors rental category) ── */}
      <div className="container mx-auto px-6 py-8">

        {/* Mobile filter toggle */}
        <div className="lg:hidden mb-6 flex justify-between items-center">
          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest border border-white px-4 py-2"
          >
            <SlidersHorizontal className="w-3 h-3" /> Filters
          </button>
          <span className="text-xs font-mono text-neutral-500">
            {filteredProductions.length} production{filteredProductions.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex gap-12">

          {/* Desktop sidebar */}
          <div className="hidden lg:block w-[280px] flex-shrink-0">
            <div className="sticky top-28">
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6 border-b border-white pb-4">
                Refine
              </h3>
              {filterContent}
            </div>
          </div>

          {/* Grid */}
          <div className="flex-grow min-w-0">

            {/* Sort / count bar */}
            <div className="hidden lg:flex justify-between items-center mb-8 pb-4 border-b border-white/5">
              <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest">
                {filteredProductions.length} production{filteredProductions.length !== 1 ? 's' : ''} found
              </span>
            </div>

            {/* ── Packages (with preview images) ── */}
            {showPackages && packages.length > 0 && (
              <div className="mb-12">
                <h2 className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-2">
                  Book a Package
                </h2>
                <h3 className="text-xl font-bold uppercase tracking-tight mb-6">
                  {category.name} Packages
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-6">
                  {packages.map((pkg) => (
                    <PackageCard
                      key={pkg.id}
                      pkg={pkg}
                      previewImage={packagePreviewImages[pkg.id]}
                      isFeatured={pkg.popular ?? false}
                      vatRate={vatRate}
                    />
                  ))}

                  {/* Custom quote */}
                  <div className="flex flex-col border border-neutral-800 bg-neutral-900/50 hover:border-neutral-700 transition-colors">
                    <div className="relative aspect-[16/9] overflow-hidden bg-neutral-900 flex items-center justify-center">
                      <div className="text-center p-6">
                        <span className="text-3xl font-bold text-[#D4A843] font-mono block mb-2">
                          Custom
                        </span>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                          Tailored to your vision
                        </span>
                      </div>
                    </div>
                    <div className="p-5 flex-grow flex flex-col">
                      <h4 className="text-lg font-semibold text-white">Custom {category.name}</h4>
                      <p className="text-neutral-400 text-sm mt-1 mb-4">
                        Tailored to your vision and budget
                      </p>
                      <ul className="flex-1 space-y-2 mb-5">
                        {['Bespoke scope & timeline', 'Dedicated project manager', 'Flexible deliverables'].map((item) => (
                          <li key={item} className="flex items-start gap-2 text-sm text-neutral-300">
                            <span className="text-[#D4A843] mt-0.5 shrink-0">&#10003;</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                      <Link
                        href={`/ubunye-ai-studio?prompt=I need a custom ${category.name.toLowerCase()} quote`}
                        className="block w-full text-center py-3 text-[10px] font-mono font-bold uppercase tracking-widest border border-[#D4A843] text-[#D4A843] hover:bg-[#D4A843]/10 transition-colors"
                      >
                        Ask Ubunye for a Quote
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Productions grid (like rental items grid) ── */}
            <div className="mb-12">
              <h2 className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-2">
                Portfolio
              </h2>
              <h3 className="text-xl font-bold uppercase tracking-tight mb-6">
                {category.name} Work
              </h3>

              {filteredProductions.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredProductions.map((p) => (
                    <ProductionCard key={p.id} production={p} />
                  ))}
                </div>
              ) : productions.length > 0 ? (
                <div className="py-16 text-center border border-dashed border-white/10">
                  <p className="text-neutral-500 font-mono text-sm uppercase tracking-widest">
                    No productions match your filter.
                  </p>
                  <button onClick={clearFilters} className="mt-4 text-xs font-bold underline">
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="py-16 text-center border border-dashed border-white/10">
                  <p className="text-neutral-500 font-mono text-sm uppercase tracking-widest mb-2">
                    No {category.name.toLowerCase()} productions uploaded yet.
                  </p>
                  <p className="text-neutral-600 text-sm">
                    Check back soon — we&apos;re adding new work every week.
                  </p>
                </div>
              )}
            </div>

            {/* ── Recommended Creators ── */}
            {creators.length > 0 && (
              <div className="mb-12">
                <h2 className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-2">
                  Recommended Creators
                </h2>
                <h3 className="text-xl font-bold uppercase tracking-tight mb-3">
                  Creators Who Do This Work
                </h3>
                <p className="text-neutral-400 text-sm mb-6 max-w-lg">
                  Verified professionals with experience in {category.name.toLowerCase()}.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {creators.map((creator) => (
                    <CreatorCard key={creator.id} creator={creator} categorySlug={category.slug} />
                  ))}
                </div>
                <div className="mt-4">
                  <Link
                    href="/studio"
                    className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors border-b border-transparent hover:border-white pb-0.5"
                  >
                    Browse all creators <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <section className="py-16 border-t border-white/5">
        <div className="container mx-auto px-6 text-center">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-4">
            Need something different?
          </h2>
          <p className="text-neutral-400 text-sm mb-6 max-w-md mx-auto">
            Every project is unique. Tell us what you need and we&apos;ll put together a custom package.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href={`/ubunye-ai-studio?prompt=I need a custom ${category.name.toLowerCase()} quote`}
              className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black px-6 py-3 hover:opacity-80 transition-opacity"
            >
              Ask Ubunye for a Quote <ChevronRight className="w-3 h-3" />
            </Link>
            <Link
              href="/contact?type=production_brief"
              className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-white text-black px-6 py-3 hover:opacity-80 transition-opacity"
            >
              Send Us a Brief <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </section>

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
              {filterContent}
            </div>
            <div className="p-6 border-t border-white/10 bg-[#080808]">
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full bg-[#D4A843] text-black py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                Show {filteredProductions.length} Result{filteredProductions.length !== 1 ? 's' : ''}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
