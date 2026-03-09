'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';
import { BookingWidget } from '@/components/booking/BookingWidget';
import { Badge } from '@/components/ui/Badge';

// ─── Category label map ───────────────────────────────────────────────────────

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

// ─── Humanise metadata keys ───────────────────────────────────────────────────

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = 'features' | 'includes';

// ─── Active media discriminated union ─────────────────────────────────────────

type ActiveMedia =
  | { type: 'image'; src: string }
  | { type: 'video' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function RentalDetailView({
  rental,
  category,
  relatedRentals = [],
}: {
  rental: SmartRental;
  category: string;
  relatedRentals?: SmartRental[];
}) {
  const categoryLabel = getCategoryLabel(category);

  // Build image list: thumbnail first, then gallery extras
  const allImages: { url: string; id: string }[] = [
    ...(rental.thumbnail_url ? [{ url: rental.thumbnail_url, id: 'thumb' }] : []),
    ...(rental.gallery ?? []).map(g => ({ url: g.url, id: g.public_id })),
  ];

  const initialSrc = rental.thumbnail_url ?? allImages[0]?.url ?? '';
  const [activeMedia, setActiveMedia] = useState<ActiveMedia>(
    initialSrc ? { type: 'image', src: initialSrc } : { type: 'video' },
  );
  const [activeTab, setActiveTab] = useState<Tab>('features');

  // Video embed URL
  let videoEmbedUrl: string | null = null;
  if (rental.video_id) {
    if (rental.video_provider === 'youtube') {
      videoEmbedUrl = `https://www.youtube.com/embed/${rental.video_id}`;
    } else if (rental.video_provider === 'vimeo') {
      videoEmbedUrl = `https://player.vimeo.com/video/${rental.video_id}`;
    }
  }

  const hasFeatures  = rental.features  && rental.features.length > 0;
  const hasIncludes  = rental.rental_includes && rental.rental_includes.length > 0;
  const hasMetadata  = rental.metadata  && Object.keys(rental.metadata).length > 0;
  const hasAnyTab    = hasFeatures || hasIncludes;

  // Currency formatter
  const fmt = (n: number) => `${rental.currency} ${n.toLocaleString()}`;

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] text-black dark:text-white pt-20 transition-colors duration-500">

      {/* ── Breadcrumb ── */}
      <div className="bg-neutral-50 dark:bg-[#080808] border-b border-black/5 dark:border-white/5 py-6">
        <div className="container mx-auto px-6">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
            <Link href="/" className="hover:text-black dark:hover:text-white transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link href="/smart-rentals" className="hover:text-black dark:hover:text-white transition-colors">
              Smart Rentals
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link
              href={`/smart-rentals/${category}`}
              className="hover:text-black dark:hover:text-white transition-colors"
            >
              {categoryLabel}
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <span className="text-black dark:text-white truncate max-w-[200px]">
              {rental.title}
            </span>
          </div>
        </div>
      </div>

      {/* ── Hero section — catalog-style gradient overlay + zoom entrance ── */}
      {rental.thumbnail_url && (
        <section className="relative h-[60vh] md:h-[70vh] w-full overflow-hidden">
          <motion.div
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-white via-white/30 to-transparent dark:from-[#050505] dark:via-[#050505]/30 dark:to-transparent z-10" />
            <Image
              src={rental.thumbnail_url}
              alt={rental.title}
              fill
              className="object-cover"
              priority
            />
          </motion.div>

          {/* Availability overlay badge */}
          <div className="absolute top-6 left-6 z-20">
            {rental.is_available ? (
              <div className="flex items-center gap-1.5 bg-green-500/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-green-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[9px] font-mono font-bold text-green-600 dark:text-green-400 uppercase tracking-widest">
                  Available
                </span>
              </div>
            ) : (
              <span className="bg-red-500 text-white text-[9px] font-mono font-bold px-3 py-1.5 uppercase tracking-widest">
                Unavailable
              </span>
            )}
          </div>

          {/* Staggered text reveals over hero */}
          <div className="absolute bottom-0 left-0 w-full z-20 pb-16 pt-32 bg-gradient-to-t from-white to-transparent dark:from-[#050505] dark:to-transparent">
            <div className="container mx-auto px-6">
              <motion.span
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="inline-block border border-black/10 dark:border-white/20 bg-white/50 dark:bg-black/50 backdrop-blur-sm px-3 py-1 text-[10px] font-bold tracking-widest uppercase mb-4 text-neutral-600 dark:text-neutral-300"
              >
                {categoryLabel}
                {rental.sub_category ? ` / ${rental.sub_category}` : ''}
              </motion.span>
              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-4xl md:text-7xl font-display font-black tracking-tighter uppercase mb-4 text-black dark:text-white"
              >
                {rental.title}
              </motion.h1>
              {(rental.brand || rental.model) && (
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-sm md:text-base text-neutral-600 dark:text-neutral-400 font-mono uppercase tracking-widest"
                >
                  {[rental.brand, rental.model].filter(Boolean).join(' ')}
                </motion.p>
              )}
              {rental.description && (
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 1.1 }}
                  className="text-base md:text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl font-light leading-relaxed mt-4"
                >
                  {rental.description}
                </motion.p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Main two-column layout ── */}
      <div className="container mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-[1fr_420px] gap-12 xl:gap-20 items-start">

          {/* ── LEFT: Media gallery ── */}
          <div>
            {/* Hero media — image or video (shown when no thumbnail for hero) */}
            {!rental.thumbnail_url && (
              <motion.div
                key={activeMedia.type === 'video' ? '__video__' : activeMedia.type === 'image' ? activeMedia.src : ''}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="relative aspect-[4/3] overflow-hidden bg-neutral-100 dark:bg-neutral-900 mb-4"
              >
                {activeMedia.type === 'video' && videoEmbedUrl ? (
                  <iframe
                    src={videoEmbedUrl}
                    className="absolute inset-0 w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={`${rental.title} video`}
                  />
                ) : activeMedia.type === 'image' ? (
                  <Image
                    src={activeMedia.src}
                    alt={rental.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                      No image
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* Gallery — displayed when hero is active */}
            {rental.thumbnail_url && (
              <motion.div
                key={activeMedia.type === 'video' ? '__video__' : activeMedia.type === 'image' ? activeMedia.src : ''}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="relative aspect-[4/3] overflow-hidden bg-neutral-100 dark:bg-neutral-900 mb-4"
              >
                {activeMedia.type === 'video' && videoEmbedUrl ? (
                  <iframe
                    src={videoEmbedUrl}
                    className="absolute inset-0 w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={`${rental.title} video`}
                  />
                ) : activeMedia.type === 'image' ? (
                  <Image
                    src={activeMedia.src}
                    alt={rental.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                      No image
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* Thumbnail strip — images + optional video thumb */}
            {(allImages.length > 1 || !!videoEmbedUrl) && (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {/* Image thumbnails */}
                {allImages.map(img => (
                  <button
                    key={img.id}
                    onClick={() => setActiveMedia({ type: 'image', src: img.url })}
                    className={`flex-shrink-0 w-20 h-20 overflow-hidden border-2 transition-all duration-200 relative ${
                      activeMedia.type === 'image' && activeMedia.src === img.url
                        ? 'border-accent-gold'
                        : 'border-transparent hover:border-black/30 dark:hover:border-white/30'
                    }`}
                  >
                    <Image
                      src={img.url}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </button>
                ))}

                {/* Video thumbnail — only when a video exists */}
                {videoEmbedUrl && (
                  <button
                    onClick={() => setActiveMedia({ type: 'video' })}
                    aria-label="Play product video"
                    className={`flex-shrink-0 w-20 h-20 overflow-hidden border-2 transition-all duration-200 relative bg-neutral-900 ${
                      activeMedia.type === 'video'
                        ? 'border-accent-gold'
                        : 'border-transparent hover:border-black/30 dark:hover:border-white/30'
                    }`}
                  >
                    {/* Dimmed thumbnail behind play icon */}
                    {rental.thumbnail_url && (
                      <Image
                        src={rental.thumbnail_url}
                        alt=""
                        fill
                        sizes="80px"
                        className="object-cover opacity-40"
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center">
                        <svg
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="w-3.5 h-3.5 text-black translate-x-0.5"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  </button>
                )}
              </div>
            )}

            {/* ── Full-width: Technical Specs (moved under gallery on left) ── */}
            {hasMetadata && (
              <div className="mt-12 pt-12 border-t border-black/5 dark:border-white/5">
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-accent-gold pl-4 uppercase">
                  Technical Specifications
                </h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10 max-w-3xl">
                  {Object.entries(rental.metadata!).map(([key, val]) => (
                    <div
                      key={key}
                      className="flex flex-col gap-1 p-4 bg-white dark:bg-[#0A0A0B]"
                    >
                      <dt className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                        {humanizeKey(key)}
                      </dt>
                      <dd className="text-sm font-medium text-black dark:text-white">
                        {val}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* ── RIGHT: Product info ── */}
          <div className="lg:sticky lg:top-28 lg:self-start">

            {/* Rental category label (shown when no hero thumbnail) */}
            {!rental.thumbnail_url && (
              <>
                <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
                  {categoryLabel}
                </p>
                <h1 className="text-3xl md:text-4xl font-display font-medium uppercase tracking-tight leading-tight text-black dark:text-white mb-2">
                  {rental.title}
                </h1>
                {(rental.brand || rental.model) && (
                  <div className="mb-6">
                    {rental.brand && (
                      <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
                        {rental.brand}
                      </p>
                    )}
                    {rental.model && (
                      <p className="text-xs font-mono text-neutral-500">{rental.model}</p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Featured badge */}
            {rental.is_featured && (
              <div className="mb-4">
                <Badge variant="featured">Featured</Badge>
              </div>
            )}

            {/* Pricing */}
            {(rental.price_per_day != null || rental.price_per_week != null) ? (
              <div className="border border-black/10 dark:border-white/10 p-5 mb-6 space-y-3 bg-neutral-50 dark:bg-[#0A0A0B]">
                {rental.price_per_day != null && (
                  <div className="flex items-end justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                      Daily Rate
                    </span>
                    <span className="text-2xl font-bold text-accent-gold">
                      {fmt(rental.price_per_day)}
                    </span>
                  </div>
                )}
                {rental.price_per_week != null && (
                  <div className="flex items-end justify-between border-t border-black/5 dark:border-white/5 pt-3">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                      Weekly Rate
                    </span>
                    <span className="text-lg font-semibold text-black dark:text-white">
                      {fmt(rental.price_per_week)}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-6 border border-dashed border-black/10 dark:border-white/10 p-4">
                Contact us for pricing
              </p>
            )}

            {/* Description — only when no hero (hero shows description) */}
            {!rental.thumbnail_url && rental.description && (
              <div className="mb-6 pb-6 border-b border-black/5 dark:border-white/5">
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed whitespace-pre-line">
                  {rental.description}
                </p>
              </div>
            )}

            {/* ── Tabs ── */}
            {(hasAnyTab) && (
              <div className="mb-8">
                {/* Tab headers */}
                <div className="flex border-b border-black/10 dark:border-white/10 mb-6">
                  {hasFeatures && (
                    <button
                      onClick={() => setActiveTab('features')}
                      className={`text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
                        activeTab === 'features'
                          ? 'border-accent-gold text-black dark:text-white'
                          : 'border-transparent text-neutral-400 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      Features
                    </button>
                  )}
                  {hasIncludes && (
                    <button
                      onClick={() => setActiveTab('includes')}
                      className={`text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
                        activeTab === 'includes'
                          ? 'border-accent-gold text-black dark:text-white'
                          : 'border-transparent text-neutral-400 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      Rental Includes
                    </button>
                  )}
                </div>

                {/* Tab content */}
                <div>
                  {activeTab === 'features' && hasFeatures && (
                    <motion.ul
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      {rental.features!.map((feat, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <Check className="w-3.5 h-3.5 text-accent-gold flex-shrink-0 mt-0.5" />
                          <span className="text-sm text-neutral-700 dark:text-neutral-300 leading-snug">
                            {feat}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}

                  {activeTab === 'includes' && hasIncludes && (
                    <motion.ul
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      {rental.rental_includes!.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <Check className="w-3.5 h-3.5 text-black dark:text-white flex-shrink-0 mt-0.5" />
                          <span className="text-sm text-neutral-700 dark:text-neutral-300 leading-snug">
                            {item}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}

                </div>
              </div>
            )}

            {/* ── Booking Widget — always visible in sidebar ── */}
            <div className="mb-8 border border-black/10 dark:border-white/10 p-5 bg-neutral-50 dark:bg-[#0A0A0B]">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-4 border-b border-black/5 dark:border-white/5 pb-3">
                Book This Equipment
              </h3>
              <BookingWidget rental={rental} />
            </div>

            {/* Tags */}
            {rental.tags && rental.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rental.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 border border-black/10 dark:border-white/10 px-2 py-1 bg-neutral-50 dark:bg-white/5"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Related Equipment ── */}
        {relatedRentals.length > 0 && (
          <div className="mt-16 pt-12 border-t border-black/5 dark:border-white/5">
            <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-accent-gold pl-4 uppercase">
              Related Equipment
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10">
              {relatedRentals.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Link
                    href={`/smart-rentals/${item.category}/${item.slug}`}
                    className="block bg-white dark:bg-[#0A0A0B] group hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100 dark:bg-neutral-900">
                      {item.thumbnail_url ? (
                        <Image
                          src={item.thumbnail_url}
                          alt={item.title}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                          className="object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-500"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                            No image
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-4">
                      <h3 className="text-sm font-display font-medium uppercase tracking-tight text-black dark:text-white truncate group-hover:text-accent-gold transition-colors">
                        {item.title}
                      </h3>
                      {item.brand && (
                        <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest mt-1">
                          {item.brand}
                        </p>
                      )}
                      {item.price_per_day != null && (
                        <p className="text-sm font-mono font-bold text-accent-gold mt-2">
                          {item.currency} {item.price_per_day.toLocaleString()}
                          <span className="text-[10px] font-normal text-neutral-500"> /day</span>
                        </p>
                      )}
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* ── Back link ── */}
        <div className="mt-16 pt-8 border-t border-black/5 dark:border-white/5">
          <Link
            href={`/smart-rentals/${category}`}
            className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 hover:text-accent-gold transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {categoryLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
