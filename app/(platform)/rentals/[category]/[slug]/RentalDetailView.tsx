'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, ChevronRight, ShieldCheck, User } from 'lucide-react';
import type { SmartRental, RentalOwner } from '@/lib/supabase/queries/smartRentals';
import { BookingWidget } from '@/components/booking/BookingWidget';
import { Badge } from '@/components/ui/Badge';
import { protectionLine } from '@/lib/rental/protection';
import { formatRand } from '@/lib/format/money';

// ─── Category label map ───────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  'cameras-optics':        'Cameras & Optics',
  'lighting-power':        'Lighting & Power',
  'audio':                 'Audio',
  'grip-motion':           'Grip & Motion',
  'data-storage':          'Data & Storage',
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
  owner = null,
  paymentsOpen,
}: {
  rental: SmartRental;
  /** onlinePaymentsOpen() from the server. */
  paymentsOpen?: boolean;
  category: string;
  relatedRentals?: SmartRental[];
  /** Community owner of this listing; null for studio-owned stock. */
  owner?: RentalOwner | null;
}) {
  const categoryLabel = getCategoryLabel(category);

  // Build image list from gallery. First image is the hero/preview.
  const allImages: { url: string; id: string }[] = (rental.gallery ?? []).map(g => ({ url: g.url, id: g.public_id }));
  const heroImage = allImages[0]?.url ?? null;

  const initialSrc = heroImage ?? '';
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
  const fmt = (n: number) => formatRand(n);

  // On a phone the booking box sits far below the photos and specs, so the
  // price and the one action stay pinned to the bottom of the screen.
  const pinnedBar = rental.is_available && rental.price_per_day != null && (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050505]/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-3">
      <p className="font-mono text-sm text-white">
        {fmt(rental.price_per_day)}
        <span className="text-neutral-400"> a day</span>
      </p>
      <a
        href="#book"
        className="min-h-[44px] inline-flex items-center px-5 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest"
      >
        Book This Equipment
      </a>
    </div>
  );

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] text-black dark:text-white pt-20 pb-20 lg:pb-0 transition-colors duration-500">
      {pinnedBar}

      {/* ── Breadcrumb ── */}
      <div className="bg-neutral-50 dark:bg-[#080808] border-b border-black/5 dark:border-white/5 py-6">
        <div className="container mx-auto px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400">
            <Link href="/" className="hover:text-black dark:hover:text-white transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link href="/rentals" className="hover:text-black dark:hover:text-white transition-colors">
              Rentals
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link
              href={`/rentals/${category}`}
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

      {/* ── Hero section: first gallery image as hero ── */}
      {heroImage && (
        <section className="relative h-[60vh] md:h-[70vh] w-full overflow-hidden">
          <motion.div
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-white via-white/30 to-transparent dark:from-[#050505] dark:via-[#050505]/30 dark:to-transparent z-10" />
            <Image
              src={heroImage}
              alt={rental.title}
              fill
              sizes="100vw"
              className="object-cover"
              priority
            />
          </motion.div>

          {/* Availability overlay badge */}
          <div className="absolute top-6 left-6 z-20">
            {/* No "Available" badge: availability depends on dates, and the
                booking box checks the dates you choose. */}
            {rental.is_available ? null : (
              <span className="bg-red-500 text-white text-xs font-mono font-bold px-3 py-1.5 uppercase tracking-widest">
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
                className="inline-block border border-black/10 dark:border-white/20 bg-white/50 dark:bg-black/50 backdrop-blur-sm px-3 py-1 text-xs font-bold tracking-widest uppercase mb-4 text-neutral-400 dark:text-neutral-300"
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
                  className="text-sm md:text-base text-neutral-400 dark:text-neutral-400 font-mono uppercase tracking-widest"
                >
                  {[rental.brand, rental.model].filter(Boolean).join(' ')}
                </motion.p>
              )}
              {rental.description && (
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 1.1 }}
                  className="text-base md:text-lg text-neutral-400 dark:text-neutral-400 max-w-2xl font-light leading-relaxed mt-4"
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-12 xl:gap-20 items-start">

          {/* ── LEFT: Media gallery ── */}
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            {/* Hero media: image or video (shown when no gallery images for hero) */}
            {!heroImage && (
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
                    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={`${rental.title} video`}
                  />
                ) : activeMedia.type === 'image' ? (
                  <Image
                    src={activeMedia.src}
                    alt={rental.title}
                    fill
                    sizes="(min-width: 1024px) 60vw, 100vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                      No image
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* Gallery: displayed when hero is active */}
            {heroImage && (
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
                    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={`${rental.title} video`}
                  />
                ) : activeMedia.type === 'image' ? (
                  <Image
                    src={activeMedia.src}
                    alt={rental.title}
                    fill
                    sizes="(min-width: 1024px) 60vw, 100vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                      No image
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* Thumbnail strip: images and optional video thumb */}
            {(allImages.length > 1 || !!videoEmbedUrl) && (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {/* Image thumbnails */}
                {allImages.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => setActiveMedia({ type: 'image', src: img.url })}
                    aria-label={`Show photo ${i + 1} of ${allImages.length}`}
                    aria-pressed={activeMedia.type === 'image' && activeMedia.src === img.url}
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

                {/* Video thumbnail: only when a video exists */}
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
                    {/* Dimmed first gallery image behind play icon */}
                    {heroImage && (
                      <Image
                        src={heroImage}
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
          </div>

          {/* ── RIGHT: Product info ── */}
          <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-28 lg:self-start">

            {/* Rental category label (shown when no gallery hero) */}
            {!heroImage && (
              <>
                <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
                  {categoryLabel}
                </p>
                <h1 className="text-3xl md:text-4xl font-display font-medium uppercase tracking-tight leading-tight text-black dark:text-white mb-2">
                  {rental.title}
                </h1>
                {(rental.brand || rental.model) && (
                  <div className="mb-6">
                    {rental.brand && (
                      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                        {rental.brand}
                      </p>
                    )}
                    {rental.model && (
                      <p className="text-xs font-mono text-neutral-400">{rental.model}</p>
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
                    <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                      Daily Rate
                    </span>
                    <span className="text-2xl font-bold text-accent-gold">
                      {fmt(rental.price_per_day)}
                    </span>
                  </div>
                )}
                {rental.price_per_week != null && (
                  <div className="flex items-end justify-between border-t border-black/5 dark:border-white/5 pt-3">
                    <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                      Weekly Rate
                    </span>
                    <span className="text-lg font-semibold text-black dark:text-white">
                      {fmt(rental.price_per_week)}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-6 border border-dashed border-black/10 dark:border-white/10 p-4">
                Contact us for pricing
              </p>
            )}

            {/* Description: only when no hero (hero shows description) */}
            {!heroImage && rental.description && (
              <div className="mb-6 pb-6 border-b border-black/5 dark:border-white/5">
                <p className="text-sm text-neutral-400 dark:text-neutral-400 leading-relaxed whitespace-pre-line">
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
                      className={`text-xs font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
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
                      className={`text-xs font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
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
                          <span className="text-sm text-neutral-400 dark:text-neutral-300 leading-snug">
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
                          <span className="text-sm text-neutral-400 dark:text-neutral-300 leading-snug">
                            {item}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}

                </div>
              </div>
            )}

            {/* ── Booking Widget: always visible in sidebar ── */}
            <div id="book" className="mb-8 border border-black/10 dark:border-white/10 p-5 bg-neutral-50 dark:bg-[#0A0A0B] scroll-mt-24">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-4 border-b border-black/5 dark:border-white/5 pb-3">
                Book This Equipment
              </h3>
              <BookingWidget rental={rental} paymentsOpen={paymentsOpen} />
              {protectionLine(rental) && (
                <p className="mt-4 flex items-start gap-2 text-xs font-mono text-neutral-400">
                  <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#D4A843]" aria-hidden="true" />
                  {protectionLine(rental)}
                </p>
              )}
            </div>

            {/* ── Who owns this ──
                The other half of the loop. Renting a camera should be a route
                to the person who shoots with it: someone with no network gets
                found through their gear. Absent for studio-owned stock, where
                "owned by ThabangVision" on a ThabangVision page says nothing. */}
            {owner && (
              <div className="mb-8 border border-black/10 dark:border-white/10 p-5">
                <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-4 border-b border-black/5 dark:border-white/5 pb-3">
                  Owned By
                </h3>
                <Link href={`/creators/${owner.id}`} className="group flex items-center gap-3">
                  <div className="relative w-11 h-11 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-900 flex-shrink-0">
                    {owner.avatar_url ? (
                      <Image
                        src={owner.avatar_url}
                        alt={owner.display_name ?? 'Owner'}
                        fill
                        sizes="44px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User className="w-5 h-5 text-neutral-400 dark:text-neutral-400" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-display font-medium uppercase text-black dark:text-white truncate group-hover:text-accent-gold transition-colors flex items-center gap-1.5">
                      {owner.display_name ?? 'Creator'}
                      {owner.is_verified && (
                        <Check className="w-3 h-3 text-accent-gold flex-shrink-0" />
                      )}
                    </p>
                    {owner.specializations && owner.specializations.length > 0 && (
                      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mt-0.5 truncate">
                        {owner.specializations.slice(0, 2).join(' · ')}
                      </p>
                    )}
                  </div>
                </Link>
                {owner.is_bookable && (
                  <p className="text-xs text-neutral-400 font-light mt-4 pt-4 border-t border-black/5 dark:border-white/5">
                    Also available for hire.{' '}
                    <Link
                      href={`/creators/${owner.id}`}
                      className="underline underline-offset-2 hover:text-accent-gold transition-colors"
                    >
                      See their work
                    </Link>
                  </p>
                )}
              </div>
            )}

            {/* Tags */}
            {rental.tags && rental.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rental.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs font-mono uppercase tracking-widest text-neutral-400 border border-black/10 dark:border-white/10 px-2 py-1 bg-neutral-50 dark:bg-white/5"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Technical specs: under the gallery on desktop, after the booking box on phones ── */}
          {hasMetadata && (
            <div className="lg:col-start-1 lg:row-start-2">
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
                        <dt className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                          {humanizeKey(key)}
                        </dt>
                        <dd className="text-sm font-medium text-black dark:text-white">
                          {val}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
            </div>
          )}
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
                    href={`/rentals/${item.category}/${item.slug}`}
                    className="block bg-white dark:bg-[#0A0A0B] group hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                  >
                    {/* Preview: first gallery image */}
                    <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100 dark:bg-neutral-900">
                      {item.gallery && item.gallery.length > 0 ? (
                        <Image
                          src={item.gallery[0].url}
                          alt={item.title}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                          className="object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 group-hover:scale-105 transition-all duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
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
                        <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest mt-1">
                          {item.brand}
                        </p>
                      )}
                      {item.price_per_day != null && (
                        <p className="text-sm font-mono font-bold text-accent-gold mt-2">
                          {formatRand(item.price_per_day)}
                          <span className="text-xs font-normal text-neutral-400"> a day</span>
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
            href={`/rentals/${category}`}
            className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 hover:text-accent-gold transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {categoryLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
