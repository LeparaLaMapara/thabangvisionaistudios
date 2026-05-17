'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Building2, Clock, Info } from 'lucide-react';
import type { ProductionCategory, ProductionPackage } from '@/types/production';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';
import { calculatePackagePrice, formatZAR } from '@/lib/productions/pricing';
import { Badge } from '@/components/ui/Badge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toEmbedUrl(provider: string | null, url: string | null): string | null {
  if (!url) return null;
  if (provider === 'youtube') {
    const id = url.match(/(?:youtu\.be\/|v=)([^&\s]+)/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (provider === 'vimeo') {
    const id = url.match(/vimeo\.com\/(\d+)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'deliverables' | 'breakdown';

type ActiveMedia =
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }
  | { type: 'none' };

type VideoThumb = { embedUrl: string; title: string };

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductionPackageDetailView({
  pkg,
  category,
  productions = [],
  relatedPackages = [],
}: {
  pkg: ProductionPackage;
  category: ProductionCategory;
  productions?: SmartProduction[];
  relatedPackages?: ProductionPackage[];
}) {
  const [activeTab, setActiveTab] = useState<Tab>('deliverables');
  const pricing = calculatePackagePrice(pkg);
  const totalHours = pkg.services.reduce((sum, s) => sum + s.hours, 0);

  // ── Build gallery from studio productions ──────────────────────────────────
  const allImages = useMemo(() => {
    const imgs: { url: string; id: string }[] = [];
    for (const prod of productions) {
      if (prod.thumbnail_url) {
        imgs.push({ url: prod.thumbnail_url, id: `thumb-${prod.id}` });
      }
      for (const g of prod.gallery ?? []) {
        imgs.push({ url: g.url, id: g.public_id });
      }
    }
    return imgs;
  }, [productions]);

  const heroImage = allImages[0]?.url ?? null;

  // Collect video embeds from productions
  const videoThumbs = useMemo<VideoThumb[]>(() => {
    const vids: VideoThumb[] = [];
    for (const prod of productions) {
      const embed = toEmbedUrl(prod.video_provider, prod.video_url);
      if (embed) {
        vids.push({ embedUrl: embed, title: prod.title });
      }
    }
    return vids;
  }, [productions]);

  const [activeMedia, setActiveMedia] = useState<ActiveMedia>(() => {
    if (heroImage) return { type: 'image', src: heroImage };
    if (videoThumbs.length > 0) return { type: 'video', src: videoThumbs[0].embedUrl };
    return { type: 'none' };
  });

  return (
    <div className="min-h-screen bg-[#050505] text-white pt-20 transition-colors duration-500">

      {/* ── Breadcrumb ── */}
      <div className="bg-[#080808] border-b border-white/5 py-6">
        <div className="container mx-auto px-6">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link href="/studio" className="hover:text-white transition-colors">
              Smart Productions
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link
              href={`/studio/category/${category.slug}`}
              className="hover:text-white transition-colors"
            >
              {category.name}
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <span className="text-white truncate max-w-[200px]">{pkg.name}</span>
          </div>
        </div>
      </div>

      {/* ── Hero section: first gallery image ── */}
      {heroImage && (
        <section className="relative h-[60vh] md:h-[70vh] w-full overflow-hidden">
          <motion.div
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/30 to-transparent z-10" />
            <Image
              src={heroImage}
              alt={pkg.name}
              fill
              className="object-cover"
              priority
            />
          </motion.div>

          {/* Studio badge overlay */}
          <div className="absolute top-6 left-6 z-20">
            <div className="flex items-center gap-1.5 bg-[#D4A843]/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-[#D4A843]/20">
              <Building2 className="w-3 h-3 text-[#D4A843]" />
              <span className="text-[9px] font-mono font-bold text-[#D4A843] uppercase tracking-widest">
                Studio Package
              </span>
            </div>
          </div>

          {/* Staggered text reveals over hero */}
          <div className="absolute bottom-0 left-0 w-full z-20 pb-16 pt-32 bg-gradient-to-t from-[#050505] to-transparent">
            <div className="container mx-auto px-6">
              <motion.span
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="inline-block border border-white/20 bg-black/50 backdrop-blur-sm px-3 py-1 text-[10px] font-bold tracking-widest uppercase mb-4 text-neutral-300"
              >
                {category.name}
              </motion.span>
              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-4xl md:text-7xl font-display font-black tracking-tighter uppercase mb-4 text-white"
              >
                {pkg.name}
              </motion.h1>
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.9 }}
                className="text-base md:text-lg text-neutral-400 max-w-2xl font-light leading-relaxed"
              >
                {pkg.description}
              </motion.p>
            </div>
          </div>
        </section>
      )}

      {/* ── Main two-column layout ── */}
      <div className="container mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-[1fr_420px] gap-12 xl:gap-20 items-start">

          {/* ── LEFT: Gallery + Details ── */}
          <div>

            {/* Title block when no hero image */}
            {!heroImage && (
              <div className="mb-12">
                <div className="flex items-center gap-3 mb-6">
                  <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-[#D4A843] bg-[#D4A843]/10 px-3 py-1 rounded-full border border-[#D4A843]/20">
                    <Building2 className="w-3 h-3" />
                    Studio Package
                  </span>
                  {pkg.popular && <Badge variant="featured">Popular</Badge>}
                </div>
                <h1 className="text-4xl md:text-6xl font-display font-black tracking-tighter uppercase mb-4">
                  {pkg.name}
                </h1>
                <p className="text-base text-neutral-400 max-w-2xl font-light leading-relaxed">
                  {pkg.description}
                </p>
              </div>
            )}

            {/* ── Media viewer — matches RentalDetailView ── */}
            {(allImages.length > 0 || videoThumbs.length > 0) && (
              <>
                <motion.div
                  key={activeMedia.type !== 'none' ? activeMedia.src : 'none'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="relative aspect-[4/3] overflow-hidden bg-neutral-900 mb-4"
                >
                  {activeMedia.type === 'video' ? (
                    <iframe
                      src={activeMedia.src}
                      className="absolute inset-0 w-full h-full"
                      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      title={`${pkg.name} video`}
                    />
                  ) : activeMedia.type === 'image' ? (
                    <Image
                      src={activeMedia.src}
                      alt={pkg.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                        No preview
                      </span>
                    </div>
                  )}
                </motion.div>

                {/* Thumbnail strip */}
                {(allImages.length > 1 || videoThumbs.length > 0) && (
                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                    {/* Image thumbnails */}
                    {allImages.map(img => (
                      <button
                        key={img.id}
                        onClick={() => setActiveMedia({ type: 'image', src: img.url })}
                        className={`flex-shrink-0 w-20 h-20 overflow-hidden border-2 transition-all duration-200 relative ${
                          activeMedia.type === 'image' && activeMedia.src === img.url
                            ? 'border-[#D4A843]'
                            : 'border-transparent hover:border-white/30'
                        }`}
                      >
                        <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
                      </button>
                    ))}

                    {/* Video thumbnails */}
                    {videoThumbs.map((vid, i) => (
                      <button
                        key={`vid-${i}`}
                        onClick={() => setActiveMedia({ type: 'video', src: vid.embedUrl })}
                        aria-label={`Play video: ${vid.title}`}
                        className={`flex-shrink-0 w-20 h-20 overflow-hidden border-2 transition-all duration-200 relative bg-neutral-900 ${
                          activeMedia.type === 'video' && activeMedia.src === vid.embedUrl
                            ? 'border-[#D4A843]'
                            : 'border-transparent hover:border-white/30'
                        }`}
                      >
                        {heroImage && (
                          <Image src={heroImage} alt="" fill sizes="80px" className="object-cover opacity-40" />
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
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Service summary ── */}
            <div className="mt-12 pt-12 border-t border-white/5">
              <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-[#D4A843] pl-4 uppercase">
                What&apos;s Included
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/10 border border-white/10">
                {pkg.services.map((service, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 p-5 bg-[#0A0A0B]"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-[#D4A843]" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                        {service.type === 'postProduction' ? 'Post Production' : service.type}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-white capitalize">
                      {service.subType.replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                    <p className="text-xs font-mono text-neutral-500">
                      {service.hours} hour{service.hours !== 1 ? 's' : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Tabs: Deliverables / Price Breakdown ── */}
            <div className="mt-12 pt-12 border-t border-white/5">
              <div className="flex border-b border-white/10 mb-6">
                <button
                  onClick={() => setActiveTab('deliverables')}
                  className={`text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
                    activeTab === 'deliverables'
                      ? 'border-[#D4A843] text-white'
                      : 'border-transparent text-neutral-400 hover:text-white'
                  }`}
                >
                  Deliverables
                </button>
                <button
                  onClick={() => setActiveTab('breakdown')}
                  className={`text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-3 border-b-2 -mb-px transition-colors ${
                    activeTab === 'breakdown'
                      ? 'border-[#D4A843] text-white'
                      : 'border-transparent text-neutral-400 hover:text-white'
                  }`}
                >
                  Price Breakdown
                </button>
              </div>

              {activeTab === 'deliverables' && (
                <motion.ul
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-3"
                >
                  {pkg.deliverables.map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Check className="w-3.5 h-3.5 text-[#D4A843] flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-neutral-300 leading-snug">{item}</span>
                    </li>
                  ))}
                </motion.ul>
              )}

              {activeTab === 'breakdown' && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="border border-white/10 bg-[#0A0A0B]">
                    {pricing.lineItems.map((item, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between p-4 ${
                          i > 0 ? 'border-t border-white/5' : ''
                        }`}
                      >
                        <div>
                          <p className="text-sm text-white">{item.service}</p>
                          <p className="text-[10px] font-mono text-neutral-500">
                            {item.hours}hr × {formatZAR(item.rate)}/hr
                          </p>
                        </div>
                        <span className="text-sm font-mono font-bold text-white">
                          {formatZAR(item.amount)}
                        </span>
                      </div>
                    ))}

                    <div className="border-t border-white/10 p-4 flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                        Subtotal
                      </span>
                      <span className="text-sm font-mono text-white">{formatZAR(pricing.subtotal)}</span>
                    </div>
                    <div className="border-t border-white/5 p-4 flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                        VAT (15%)
                      </span>
                      <span className="text-sm font-mono text-neutral-400">{formatZAR(pricing.vat)}</span>
                    </div>
                    <div className="border-t border-white/10 p-4 flex items-center justify-between bg-[#D4A843]/5">
                      <span className="text-[10px] font-mono uppercase tracking-widest font-bold text-[#D4A843]">
                        Total
                      </span>
                      <span className="text-xl font-display font-bold text-[#D4A843]">
                        {formatZAR(pricing.total)}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Sticky pricing sidebar ── */}
          <div className="lg:sticky lg:top-28 lg:self-start">

            {/* Pricing box */}
            <div className="border border-white/10 p-5 mb-6 space-y-3 bg-[#0A0A0B]">
              <div className="flex items-end justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                  Package Price
                </span>
                <span className="text-2xl font-bold text-[#D4A843]">
                  {formatZAR(pricing.total)}
                </span>
              </div>
              <div className="flex items-end justify-between border-t border-white/5 pt-3">
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                  Duration
                </span>
                <span className="text-sm font-mono text-white">
                  {totalHours} hour{totalHours !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-end justify-between border-t border-white/5 pt-3">
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                  Effective Rate
                </span>
                <span className="text-sm font-mono text-neutral-400">
                  ~{formatZAR(Math.round(pricing.subtotal / totalHours))}/hr
                </span>
              </div>
            </div>

            {/* Book CTA */}
            <div className="border border-white/10 p-5 bg-[#0A0A0B] mb-6">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-4 border-b border-white/5 pb-3">
                Book This Package
              </h3>
              <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                Share your project details and preferred dates.
                We&apos;ll confirm availability and send you a quote.
              </p>
              <Link
                href={`/ubunye-ai-studio?prompt=${encodeURIComponent(`I want to book the ${pkg.name} package under ${category.name}`)}`}
                className="w-full py-3 text-[10px] font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
              >
                Book Now
              </Link>
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 text-[9px] font-mono text-neutral-600">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                Minimum booking is 4 hours. Travel fees may apply for on-location shoots.
                VAT included in total price.
              </span>
            </div>
          </div>
        </div>

        {/* ── Related Packages ── */}
        {relatedPackages.length > 0 && (
          <div className="mt-16 pt-12 border-t border-white/5">
            <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-[#D4A843] pl-4 uppercase">
              More {category.name} Packages
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {relatedPackages.map((related) => {
                const relPricing = calculatePackagePrice(related);
                const relHours = related.services.reduce((s, svc) => s + svc.hours, 0);
                return (
                  <motion.div
                    key={related.id}
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Link
                      href={`/studio/category/${category.slug}/${related.id}`}
                      className="group block bg-[#0A0A0B] border border-white/5 hover:border-[#D4A843]/30 transition-all duration-300"
                    >
                      <div className="h-1 bg-[#D4A843]" />
                      <div className="p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#D4A843] bg-[#D4A843]/10 px-2 py-0.5 rounded-full">
                            <Building2 className="w-3 h-3" />
                            Studio
                          </span>
                          {related.popular && (
                            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                              Popular
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-display font-medium text-white uppercase mb-1 group-hover:text-[#D4A843] transition-colors">
                          {related.name}
                        </h3>
                        <p className="text-[10px] font-mono text-neutral-500 mb-4">
                          {related.description}
                        </p>
                        <div className="flex items-end justify-between border-t border-white/5 pt-3">
                          <div>
                            <p className="text-lg font-display font-bold text-[#D4A843]">
                              {formatZAR(relPricing.total)}
                            </p>
                            <p className="text-[9px] font-mono text-neutral-500">
                              {relHours}hrs · ~{formatZAR(Math.round(relPricing.subtotal / relHours))}/hr
                            </p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-neutral-500 group-hover:text-[#D4A843] group-hover:translate-x-1 transition-all" />
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Back link ── */}
        <div className="mt-16 pt-8 border-t border-white/5">
          <Link
            href={`/studio/category/${category.slug}`}
            className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 hover:text-[#D4A843] transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {category.name}
          </Link>
        </div>
      </div>
    </div>
  );
}
