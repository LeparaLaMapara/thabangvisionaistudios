'use client';

import { useState, useId } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, ChevronRight, ShieldCheck, User } from 'lucide-react';
import type { SmartRental, RentalOwner } from '@/lib/supabase/queries/smartRentals';
import { BookingWidget } from '@/components/booking/BookingWidget';
import { Badge } from '@/components/ui/Badge';
import { protectionLine } from '@/lib/rental/protection';
import { formatRand } from '@/lib/format/money';
import { ContactButtons } from '@/components/payments/ContactButtons';
import { ProductVideo } from '@/components/rentals/ProductVideo';
import { youtubePosterUrl } from '@/lib/video/youtube';
import { RentalLoopVideo } from '@/components/rentals/RentalLoopVideo';
import { RentalVideoCarousel } from '@/components/rentals/RentalVideoCarousel';
import { ON_SITE_RENTAL } from '@/lib/constants';
import { collectionPointWithCity } from '@/lib/rental/collection-point';
import { halfDayPrice, isOnSiteCategory, rentalLoop, rentalVideos, specEntries } from '@/lib/rental/on-site';
import { whatsappLink } from '@/lib/payments/eft';

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
  videoPlayable = true,
}: {
  rental: SmartRental;
  /** onlinePaymentsOpen() from the server. */
  paymentsOpen?: boolean;
  category: string;
  relatedRentals?: SmartRental[];
  /** Community owner of this listing; null for studio-owned stock. */
  owner?: RentalOwner | null;
  /** False when YouTube says the video is gone or may not play on other websites. */
  videoPlayable?: boolean;
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
  const tabsId = useId();

  // The item's video, unless the server found it gone or blocked from other websites.
  const video =
    rental.video_id && videoPlayable && (rental.video_provider === 'youtube' || rental.video_provider === 'vimeo')
      ? { provider: rental.video_provider as 'youtube' | 'vimeo', id: rental.video_id }
      : null;
  const videoEmbedUrl = video ? video.id : null;

  // A place (the Studios category): priced by the full day, a half day on
  // request, used where it is. Its own videos to swipe through when it has a
  // list (metadata.videos), else its single short loop, when it has one.
  const place = isOnSiteCategory(rental.category);
  const halfDay = halfDayPrice(rental);
  const videos = rentalVideos(rental);
  const loop = videos.length > 0 ? null : rentalLoop(rental);
  const bookLabel = place ? ON_SITE_RENTAL.bookLabel : 'Book This Equipment';

  const hasFeatures  = rental.features  && rental.features.length > 0;
  const hasIncludes  = rental.rental_includes && rental.rental_includes.length > 0;
  const specs        = specEntries(rental.metadata);
  const hasMetadata  = specs.length > 0;
  const hasAnyTab    = hasFeatures || hasIncludes;
  // The tab whose panel is on screen (Includes when there are no features).
  const shownTab: Tab = activeTab === 'features' && hasFeatures ? 'features' : 'includes';

  // Currency formatter
  const fmt = (n: number) => formatRand(n);

  // On a phone the booking box sits far below the photos and specs, so the
  // price and the one action stay pinned to the bottom of the screen.
  const pinnedBar = rental.is_available && rental.price_per_day != null && (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050505]/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-3">
      <p className="font-mono text-sm text-white">
        {fmt(rental.price_per_day)}
        <span className="text-neutral-400">{place ? ` a ${ON_SITE_RENTAL.fullDayLabel.toLowerCase()}` : ' a day'}</span>
      </p>
      <a
        href="#book"
        className="min-h-[44px] inline-flex items-center px-5 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest"
      >
        {bookLabel}
      </a>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-white pt-20 pb-20 lg:pb-0 transition-colors duration-500">
      {pinnedBar}

      {/* ── Breadcrumb ── */}
      <div className="bg-[#080808] border-b border-white/5 py-2">
        <div className="container mx-auto px-6">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-2 text-xs font-mono uppercase tracking-widest text-neutral-400 min-w-0">
              <li>
                <Link href="/" className="inline-flex min-h-[44px] items-center hover:text-white transition-colors">
                  Home
                </Link>
              </li>
              <li aria-hidden="true"><ChevronRight className="w-3 h-3 flex-shrink-0" /></li>
              <li>
                <Link href="/rentals" className="inline-flex min-h-[44px] items-center hover:text-white transition-colors">
                  Rentals
                </Link>
              </li>
              <li aria-hidden="true"><ChevronRight className="w-3 h-3 flex-shrink-0" /></li>
              <li>
                <Link
                  href={`/rentals/${category}`}
                  className="inline-flex min-h-[44px] items-center hover:text-white transition-colors"
                >
                  {categoryLabel}
                </Link>
              </li>
              <li aria-hidden="true"><ChevronRight className="w-3 h-3 flex-shrink-0" /></li>
              <li aria-current="page" className="text-white truncate max-w-[200px] min-w-0">
                {rental.title}
              </li>
            </ol>
          </nav>
        </div>
      </div>

      {/* ── Hero section: first gallery image as hero ── */}
      {heroImage && (
        <section className="relative h-[60vh] md:h-[70vh] w-full overflow-hidden">
          {/* The hero is the page's largest paint. It used to fade in from
              opacity 0 over 1.5s, which pushed LCP back by the length of the
              animation; it now paints as soon as the image arrives. */}
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/30 to-transparent z-10" />
            <Image
              src={heroImage}
              alt={rental.title}
              fill
              sizes="100vw"
              className="object-cover"
              priority
            />
          </div>

          {/* Availability overlay badge */}
          <div className="absolute top-6 left-6 z-20">
            {/* No "Available" badge: availability depends on dates, and the
                booking box checks the dates you choose. */}
            {rental.is_available ? null : (
              <span className="bg-red-700 text-white text-xs font-mono font-bold px-3 py-1.5 uppercase tracking-widest">
                Unavailable
              </span>
            )}
          </div>

          {/* Staggered text reveals over hero */}
          <div className="absolute bottom-0 left-0 w-full z-20 pb-16 pt-32 bg-gradient-to-t from-[#050505] to-transparent">
            <div className="container mx-auto px-6 min-w-0">
              <span
                className="inline-block max-w-full break-words border border-white/20 bg-black/50 backdrop-blur-sm px-3 py-1 text-xs font-bold tracking-widest uppercase mb-4 text-neutral-300"
              >
                {categoryLabel}
                {rental.sub_category ? ` / ${rental.sub_category}` : ''}
              </span>
              {/* No staggered fade-in: the title and description were hidden
                  for up to 1.1s after the page had arrived. break-words keeps a
                  long model name from widening the page on a phone. */}
              <h1 className="text-4xl md:text-7xl font-display font-black tracking-tighter uppercase mb-4 text-white break-words hyphens-auto">
                {rental.title}
              </h1>
              {(rental.brand || rental.model) && (
                <p className="text-sm md:text-base text-neutral-400 font-mono uppercase tracking-widest break-words">
                  {[rental.brand, rental.model].filter(Boolean).join(' ')}
                </p>
              )}
              {rental.description && (
                <p className="text-base md:text-lg text-neutral-300 max-w-2xl font-light leading-relaxed mt-4 break-words">
                  {rental.description}
                </p>
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
                className="relative aspect-[4/3] overflow-hidden bg-neutral-900 mb-4"
              >
                {activeMedia.type === 'video' && video ? (
                  <ProductVideo provider={video.provider} videoId={video.id} title={rental.title} />
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
                className="relative aspect-[4/3] overflow-hidden bg-neutral-900 mb-4"
              >
                {activeMedia.type === 'video' && video ? (
                  <ProductVideo provider={video.provider} videoId={video.id} title={rental.title} />
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
                        : 'border-transparent hover:border-white/30'
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
                        : 'border-transparent hover:border-white/30'
                    }`}
                  >
                    {/* The video's own picture (YouTube), else the dimmed first photo */}
                    {video?.provider === 'youtube' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={youtubePosterUrl(video.id)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" loading="lazy" />
                    ) : heroImage && (
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

            {/* The listing's own videos, swiped through one at a time (RentalVideoCarousel). */}
            {videos.length > 0 && (
              <div className="mt-6">
                <RentalVideoCarousel videos={videos} label={rental.title} />
              </div>
            )}

            {/* The listing's own silent loop: poster first, plays only when cheap (RentalLoopVideo). */}
            {loop && (
              <div className="mt-6">
                <RentalLoopVideo
                  media={loop}
                  alt={`${rental.title} in use: a shoot under the softbox lights, seen as silhouettes.`}
                  label={rental.title}
                />
              </div>
            )}
          </div>

          {/* ── RIGHT: Product info ── */}
          {/* min-w-0: a grid item defaults to min-width:auto, so any long
              unbreakable content (a model name, a URL in the description, the
              booking widget) widened this column -- and the whole page -- past
              a phone's viewport. */}
          <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-28 lg:self-start">

            {/* Rental category label (shown when no gallery hero) */}
            {!heroImage && (
              <>
                <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
                  {categoryLabel}
                </p>
                <h1 className="text-3xl md:text-4xl font-display font-medium uppercase tracking-tight leading-tight text-white mb-2 break-words hyphens-auto">
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
            {place && rental.price_per_day != null ? (
              <div className="border border-white/10 p-5 mb-6 space-y-3 bg-[#0A0A0B]" data-testid="studio-prices">
                <div className="flex items-end justify-between">
                  <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                    {ON_SITE_RENTAL.fullDayLabel}
                  </span>
                  <span className="text-2xl font-bold text-accent-gold">
                    {fmt(rental.price_per_day)}
                  </span>
                </div>
                {halfDay != null && (
                  <div className="flex items-end justify-between gap-3 border-t border-white/5 pt-3">
                    <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                      {ON_SITE_RENTAL.halfDayLabel}
                    </span>
                    <span className="text-right">
                      <span className="text-lg font-semibold text-white">{fmt(halfDay)}</span>
                      <a
                        href={whatsappLink(ON_SITE_RENTAL.halfDayMessage(rental.title))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 inline-flex min-h-[44px] items-center text-xs font-mono uppercase tracking-widest text-[#D4A843] underline underline-offset-4"
                      >
                        {ON_SITE_RENTAL.halfDayAsk}
                      </a>
                    </span>
                  </div>
                )}
                <dl className="border-t border-white/5 pt-3 space-y-2 text-xs font-mono text-neutral-400">
                  <div className="flex justify-between gap-3">
                    <dt className="uppercase tracking-widest">Booking</dt>
                    <dd className="text-white text-right">{ON_SITE_RENTAL.bookingRule}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="uppercase tracking-widest">Where</dt>
                    <dd className="text-white text-right">{collectionPointWithCity()}</dd>
                  </div>
                </dl>
              </div>
            ) : (rental.price_per_day != null || rental.price_per_week != null) ? (
              <div className="border border-white/10 p-5 mb-6 space-y-3 bg-[#0A0A0B]">
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
                  <div className="flex items-end justify-between border-t border-white/5 pt-3">
                    <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                      Weekly Rate
                    </span>
                    <span className="text-lg font-semibold text-white">
                      {fmt(rental.price_per_week)}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-6 border border-dashed border-white/10 p-4">
                Contact us for pricing
              </p>
            )}

            {/* Description: only when no hero (hero shows description) */}
            {!heroImage && rental.description && (
              <div className="mb-6 pb-6 border-b border-white/5">
                <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-line break-words">
                  {rental.description}
                </p>
              </div>
            )}

            {/* ── Tabs ── */}
            {(hasAnyTab) && (
              <div className="mb-8">
                {/* Tab headers */}
                <div
                  role="tablist"
                  aria-label="Item details"
                  className="flex border-b border-white/10 mb-6"
                  onKeyDown={(e) => {
                    // Arrow keys move between tabs (WAI-ARIA tabs pattern).
                    if (!hasFeatures || !hasIncludes) return;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      const next: Tab = activeTab === 'features' ? 'includes' : 'features';
                      setActiveTab(next);
                      document.getElementById(`${tabsId}-tab-${next}`)?.focus();
                    }
                  }}
                >
                  {hasFeatures && (
                    <button
                      type="button"
                      role="tab"
                      id={`${tabsId}-tab-features`}
                      aria-selected={activeTab === 'features'}
                      aria-controls={`${tabsId}-panel-features`}
                      tabIndex={activeTab === 'features' ? 0 : -1}
                      onClick={() => setActiveTab('features')}
                      className={`min-h-[44px] text-xs font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
                        activeTab === 'features'
                          ? 'border-accent-gold text-white'
                          : 'border-transparent text-neutral-400 hover:text-white'
                      }`}
                    >
                      Features
                    </button>
                  )}
                  {hasIncludes && (
                    <button
                      type="button"
                      role="tab"
                      id={`${tabsId}-tab-includes`}
                      aria-selected={activeTab === 'includes' || !hasFeatures}
                      aria-controls={`${tabsId}-panel-includes`}
                      tabIndex={activeTab === 'includes' || !hasFeatures ? 0 : -1}
                      onClick={() => setActiveTab('includes')}
                      className={`min-h-[44px] text-xs font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
                        activeTab === 'includes' || !hasFeatures
                          ? 'border-accent-gold text-white'
                          : 'border-transparent text-neutral-400 hover:text-white'
                      }`}
                    >
                      Rental Includes
                    </button>
                  )}
                </div>

                {/* Tab content: the panel wraps the list (role="tabpanel" on the
                    <ul> itself would hide its list semantics). */}
                <div
                  role="tabpanel"
                  id={`${tabsId}-panel-${shownTab}`}
                  aria-labelledby={`${tabsId}-tab-${shownTab}`}
                  tabIndex={0}
                >
                  {activeTab === 'features' && hasFeatures && (
                    <motion.ul
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      {rental.features!.map((feat, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <Check className="w-3.5 h-3.5 text-accent-gold flex-shrink-0 mt-0.5" aria-hidden="true" />
                          <span className="text-sm text-neutral-300 leading-snug break-words min-w-0">
                            {feat}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}

                  {(activeTab === 'includes' || !hasFeatures) && hasIncludes && (
                    <motion.ul
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      {rental.rental_includes!.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <Check className="w-3.5 h-3.5 text-white flex-shrink-0 mt-0.5" aria-hidden="true" />
                          <span className="text-sm text-neutral-300 leading-snug break-words min-w-0">
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
            <div id="book" className="mb-8 border border-white/10 p-5 bg-[#0A0A0B] scroll-mt-24">
              <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-4 border-b border-white/5 pb-3">
                {bookLabel}
              </h2>
              <BookingWidget rental={rental} paymentsOpen={paymentsOpen} />
              <div className="mt-5 pt-4 border-t border-white/5 space-y-2">
                <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">Questions about this item?</p>
                <ContactButtons message={`Hi, I have a question about the ${rental.title}`} />
              </div>
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
              <div className="mb-8 border border-white/10 p-5">
                <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-4 border-b border-white/5 pb-3">
                  Owned By
                </h2>
                <Link href={`/creators/${owner.id}`} className="group flex items-center gap-3">
                  <div className="relative w-11 h-11 rounded-full overflow-hidden bg-neutral-900 flex-shrink-0">
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
                        <User className="w-5 h-5 text-neutral-400" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-display font-medium uppercase text-white truncate group-hover:text-accent-gold transition-colors flex items-center gap-1.5">
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
                  <p className="text-xs text-neutral-400 font-light mt-4 pt-4 border-t border-white/5">
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
                    className="text-xs font-mono uppercase tracking-widest text-neutral-400 border border-white/10 px-2 py-1 bg-white/5 break-all"
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
                <div className="mt-12 pt-12 border-t border-white/5">
                  <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-accent-gold pl-4 uppercase">
                    Technical Specifications
                  </h2>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/10 border border-white/10 max-w-3xl">
                    {specs.map(([key, val]) => (
                      <div
                        key={key}
                        className="flex flex-col gap-1 p-4 bg-[#0A0A0B] min-w-0"
                      >
                        <dt className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                          {humanizeKey(key)}
                        </dt>
                        <dd className="text-sm font-medium text-white break-words">
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
          <div className="mt-16 pt-12 border-t border-white/5">
            <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-accent-gold pl-4 uppercase">
              Related Equipment
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-white/10 border border-white/10">
              {relatedRentals.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Link
                    href={`/rentals/${item.category}/${item.slug}`}
                    className="block bg-[#0A0A0B] group hover:bg-white/5 transition-colors"
                  >
                    {/* Preview: first gallery image */}
                    <div className="relative aspect-[4/3] overflow-hidden bg-neutral-900">
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
                      <h3 className="text-sm font-display font-medium uppercase tracking-tight text-white truncate group-hover:text-accent-gold transition-colors">
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
        <div className="mt-16 pt-8 border-t border-white/5">
          <Link
            href={`/rentals/${category}`}
            className="inline-flex min-h-[44px] items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 hover:text-accent-gold transition-colors"
          >
            <ArrowLeft className="w-3 h-3" aria-hidden="true" />
            Back to {categoryLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
