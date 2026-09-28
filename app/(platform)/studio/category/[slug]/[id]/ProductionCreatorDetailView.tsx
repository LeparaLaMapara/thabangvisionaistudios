'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ChevronRight, Star, MapPin, Clock, Briefcase, ShieldCheck, Info,
} from 'lucide-react';
import type { CrewMember, CrewPortfolioItem, CrewReview } from '@/lib/supabase/queries/crew';
import type { ProductionCategory } from '@/types/production';
import type { PortfolioProject } from '@/types/portfolio';
import { formatRand, withServiceVat } from '@/lib/format/money';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type VideoEntry = { kind: 'embed'; embedUrl: string; title: string }
                | { kind: 'direct'; url: string; title: string };

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

// ─── Active media discriminated union ─────────────────────────────────────────

type ActiveMedia =
  | { type: 'image'; src: string }
  | { type: 'embed'; src: string }
  | { type: 'video'; src: string }
  | { type: 'none' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductionCreatorDetailView({
  crew,
  portfolio,
  reviews,
  category,
}: {
  crew: CrewMember;
  portfolio: CrewPortfolioItem[];
  reviews: CrewReview[];
  category: ProductionCategory;
}) {
  const ownProjects: PortfolioProject[] = crew.portfolio_projects ?? [];

  // Collect all images: own portfolio first, then smart_productions
  const allImages = useMemo(() => {
    const imgs: { url: string; id: string; title: string }[] = [];
    for (const p of ownProjects) {
      for (const photo of p.photos ?? []) {
        imgs.push({ url: photo.url, id: photo.public_id, title: p.title });
      }
    }
    for (const p of portfolio) {
      if (p.thumbnail_url) {
        imgs.push({ url: p.thumbnail_url, id: `thumb-${p.id}`, title: p.title });
      }
      for (const g of p.gallery ?? []) {
        imgs.push({ url: g.url, id: g.public_id, title: p.title });
      }
    }
    return imgs;
  }, [ownProjects, portfolio]);

  const heroImage = allImages[0]?.url ?? null;

  // Collect all videos: own portfolio (direct) + productions (embed/direct)
  const allVideos = useMemo(() => {
    const vids: VideoEntry[] = [];
    // Own portfolio showreels (direct video URLs)
    for (const p of ownProjects) {
      if (p.video?.url) {
        vids.push({ kind: 'direct', url: p.video.url, title: p.title });
      }
    }
    // Portfolio productions (YouTube/Vimeo embeds or direct URLs)
    for (const p of portfolio) {
      const embed = toEmbedUrl(p.video_provider, p.video_url);
      if (embed) {
        vids.push({ kind: 'embed', embedUrl: embed, title: p.title });
      } else if (p.video_url) {
        vids.push({ kind: 'direct', url: p.video_url, title: p.title });
      }
    }
    return vids;
  }, [ownProjects, portfolio]);

  const [activeMedia, setActiveMedia] = useState<ActiveMedia>(() => {
    if (heroImage) return { type: 'image', src: heroImage };
    const firstVid = allVideos[0];
    if (firstVid) {
      return firstVid.kind === 'embed'
        ? { type: 'embed', src: firstVid.embedUrl }
        : { type: 'video', src: firstVid.url };
    }
    return { type: 'none' };
  });

  // Average rating
  const avgRating = useMemo(() => {
    if (reviews.length === 0) return null;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  const primarySpec = crew.specializations[0] ?? 'Creative Professional';

  return (
    <div className="min-h-screen bg-[#050505] text-white pt-20 transition-colors duration-500">

      {/* ── Breadcrumb ── */}
      <div className="bg-[#080808] border-b border-white/5 py-6">
        <div className="container mx-auto px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link href="/studio" className="hover:text-white transition-colors">
              Studio
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link
              href={`/studio/category/${category.slug}`}
              className="hover:text-white transition-colors"
            >
              {category.name}
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <span className="text-white truncate max-w-[200px]">{primarySpec}</span>
          </div>
        </div>
      </div>

      {/* ── Hero section: first portfolio image ── */}
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
              alt="Portfolio work"
              fill
              className="object-cover"
              priority
            />
          </motion.div>

          {/* Verified badge */}
          <div className="absolute top-6 left-6 z-20">
            <div className="flex items-center gap-1.5 bg-emerald-500/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-emerald-500/20">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest">
                Verified Creator
              </span>
            </div>
          </div>

          {/* Staggered text reveals */}
          <div className="absolute bottom-0 left-0 w-full z-20 pb-16 pt-32 bg-gradient-to-t from-[#050505] to-transparent">
            <div className="container mx-auto px-6">
              <motion.span
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="inline-block border border-white/20 bg-black/50 backdrop-blur-sm px-3 py-1 text-xs font-bold tracking-widest uppercase mb-4 text-neutral-300"
              >
                {category.name} / Community Creator
              </motion.span>
              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-4xl md:text-7xl font-display font-black tracking-tighter uppercase mb-4 text-white"
              >
                {primarySpec}
              </motion.h1>
              {crew.specializations.length > 1 && (
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-sm md:text-base text-neutral-400 font-mono uppercase tracking-widest"
                >
                  {crew.specializations.slice(1).join(' / ')}
                </motion.p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Main two-column layout ── */}
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-12 xl:gap-20 items-start">

          {/* ── LEFT: Portfolio gallery ── */}
          <div>
            {/* Active media viewer — matches RentalDetailView pattern */}
            <motion.div
              key={activeMedia.type !== 'none' ? activeMedia.src : 'none'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="relative aspect-[4/3] overflow-hidden bg-neutral-900 mb-4"
            >
              {activeMedia.type === 'embed' ? (
                <iframe
                  src={activeMedia.src}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Production video"
                />
              ) : activeMedia.type === 'video' ? (
                <video
                  src={activeMedia.src}
                  className="absolute inset-0 w-full h-full object-cover"
                  controls
                  playsInline
                />
              ) : activeMedia.type === 'image' ? (
                <Image
                  src={activeMedia.src}
                  alt="Portfolio work"
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                    No portfolio yet
                  </span>
                </div>
              )}
            </motion.div>

            {/* Thumbnail strip — matches RentalDetailView pattern */}
            {(allImages.length > 1 || allVideos.length > 0) && (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {/* Image thumbnails */}
                {allImages.map((img) => (
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

                {/* Video thumbnails — embed or direct, with play icon overlay */}
                {allVideos.map((vid, i) => {
                  const vidSrc = vid.kind === 'embed' ? vid.embedUrl : vid.url;
                  const vidType = vid.kind === 'embed' ? 'embed' as const : 'video' as const;
                  const isActive =
                    (activeMedia.type === 'embed' || activeMedia.type === 'video') &&
                    activeMedia.src === vidSrc;

                  return (
                    <button
                      key={`vid-${i}`}
                      onClick={() => setActiveMedia({ type: vidType, src: vidSrc })}
                      aria-label={`Play video: ${vid.title}`}
                      className={`flex-shrink-0 w-20 h-20 overflow-hidden border-2 transition-all duration-200 relative bg-neutral-900 ${
                        isActive
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
                  );
                })}
              </div>
            )}

            {/* ── Portfolio productions list ── */}
            {portfolio.length > 0 && (
              <div className="mt-12 pt-12 border-t border-white/5">
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-[#D4A843] pl-4 uppercase">
                  Productions
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {portfolio.map((prod) => (
                    <Link
                      key={prod.id}
                      href={`/studio/${prod.slug}`}
                      className="group block bg-[#0A0A0B] border border-white/5 hover:border-[#D4A843]/30 transition-colors"
                    >
                      <div className="relative aspect-video overflow-hidden bg-neutral-900">
                        {(prod.thumbnail_url || (prod.gallery && prod.gallery.length > 0)) ? (
                          <Image
                            src={prod.thumbnail_url ?? prod.gallery![0].url}
                            alt={prod.title}
                            fill
                            sizes="(max-width: 640px) 100vw, 50vw"
                            className="object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-xs font-mono text-neutral-400 uppercase">No image</span>
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest mb-1">
                          {prod.project_type}
                        </p>
                        <h3 className="text-sm font-bold text-white uppercase group-hover:text-[#D4A843] transition-colors truncate">
                          {prod.title}
                        </h3>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ── Own Portfolio Projects ── */}
            {ownProjects.length > 0 && (
              <div className="mt-12 pt-12 border-t border-white/5">
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-[#D4A843] pl-4 uppercase">
                  Portfolio
                </h2>
                <div className="space-y-8">
                  {ownProjects.map((project) => (
                    <div key={project.id} className="bg-[#0A0A0B] border border-white/5 p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <h3 className="text-sm font-bold text-white uppercase">
                          {project.title}
                        </h3>
                        <span className="text-xs font-mono text-neutral-400 border border-white/10 px-2 py-0.5 uppercase">
                          {project.project_type}
                        </span>
                      </div>

                      {project.photos.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {project.photos.map((photo) => (
                            <button
                              key={photo.public_id}
                              onClick={() => setActiveMedia({ type: 'image', src: photo.url })}
                              className="relative aspect-square overflow-hidden bg-neutral-900 hover:opacity-80 transition-opacity"
                            >
                              <Image
                                src={photo.url}
                                alt={project.title}
                                fill
                                sizes="200px"
                                className="object-cover"
                                  />
                            </button>
                          ))}
                        </div>
                      )}

                      {project.video && (
                        <button
                          onClick={() => setActiveMedia({ type: 'video', src: project.video!.url })}
                          className="relative aspect-video bg-neutral-900 w-full group/vid"
                        >
                          <div className="absolute inset-0 flex items-center justify-center z-10">
                            <div className="w-12 h-12 rounded-full bg-white/90 group-hover/vid:bg-[#D4A843] flex items-center justify-center transition-colors">
                              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-black translate-x-0.5">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          </div>
                          <span className="absolute bottom-3 left-3 z-10 text-xs font-mono uppercase tracking-widest text-white/70">
                            Play showreel
                          </span>
                          {project.photos[0] && (
                            <Image
                              src={project.photos[0].url}
                              alt={project.title}
                              fill
                              className="object-cover opacity-50"
                              />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Reviews ── */}
            {reviews.length > 0 && (
              <div className="mt-12 pt-12 border-t border-white/5">
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-[#D4A843] pl-4 uppercase">
                  Reviews
                </h2>
                <div className="space-y-6">
                  {reviews.map((review) => (
                    <div key={review.id} className="bg-[#0A0A0B] border border-white/5 p-6">
                      <div className="flex items-center gap-1 mb-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`w-4 h-4 ${
                              i < review.rating ? 'text-[#D4A843] fill-[#D4A843]' : 'text-neutral-400'
                            }`}
                          />
                        ))}
                      </div>
                      {review.comment && (
                        <p className="text-sm text-neutral-300 leading-relaxed mb-3">
                          {review.comment}
                        </p>
                      )}
                      <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                        {new Date(review.created_at).toLocaleDateString('en-ZA', {
                          year: 'numeric',
                          month: 'short',
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Creator info sidebar ── */}
          <div className="lg:sticky lg:top-28 lg:self-start">

            {/* When no hero image, show title here */}
            {!heroImage && (
              <>
                <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
                  {category.name} / Community
                </p>
                <h1 className="text-3xl md:text-4xl font-display font-medium uppercase tracking-tight leading-tight text-white mb-6">
                  {primarySpec}
                </h1>
              </>
            )}

            {/* Rating summary */}
            {avgRating != null && (
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3.5 h-3.5 ${
                        i < Math.round(avgRating) ? 'text-[#D4A843] fill-[#D4A843]' : 'text-neutral-400'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs font-mono text-neutral-400">
                  {avgRating.toFixed(1)} ({reviews.length} review{reviews.length !== 1 ? 's' : ''})
                </span>
              </div>
            )}

            {/* Rate */}
            {crew.hourly_rate != null ? (
              <div className="border border-white/10 p-5 mb-6 space-y-3 bg-[#0A0A0B]">
                <div className="flex items-end justify-between">
                  <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                    Hourly Rate, incl. VAT
                  </span>
                  <span className="text-2xl font-bold text-[#D4A843]">
                    {formatRand(withServiceVat(crew.hourly_rate))}
                  </span>
                </div>
                <div className="flex items-end justify-between border-t border-white/5 pt-3">
                  <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                    Min. Booking
                  </span>
                  <span className="text-sm font-mono text-neutral-400">
                    4 hours ({formatRand(withServiceVat(crew.hourly_rate * 4))})
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-6 border border-dashed border-white/10 p-4">
                Contact for rates
              </p>
            )}

            {/* Details */}
            <div className="space-y-4 mb-8">
              {crew.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  <span className="text-sm text-neutral-300">{crew.location}</span>
                </div>
              )}
              {crew.years_experience != null && (
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  <span className="text-sm text-neutral-300">
                    {crew.years_experience} year{crew.years_experience !== 1 ? 's' : ''} experience
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Briefcase className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                <span className="text-sm text-neutral-300">
                  {portfolio.length} production{portfolio.length !== 1 ? 's' : ''} completed
                </span>
              </div>
            </div>

            {/* Specializations */}
            <div className="mb-8">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-4 border-b border-white/5 pb-3">
                Specializations
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {crew.specializations.map((spec) => (
                  <span
                    key={spec}
                    className="text-xs font-mono uppercase tracking-widest text-neutral-400 border border-white/10 px-2 py-1 bg-white/5"
                  >
                    {spec}
                  </span>
                ))}
              </div>
            </div>

            {/* Skills */}
            {crew.skills && crew.skills.length > 0 && (
              <div className="mb-8">
                <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-4 border-b border-white/5 pb-3">
                  Skills
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {crew.skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-xs font-mono uppercase tracking-widest text-neutral-400 border border-white/5 px-2 py-1"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Book CTA */}
            <div className="border border-white/10 p-5 bg-[#0A0A0B] mb-6">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-4 border-b border-white/5 pb-3">
                Book This Creator
              </h3>
              <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                Identity is revealed after your booking is confirmed and paid.
              </p>
              <Link
                href={`/book?creator_id=${crew.id}&category=${encodeURIComponent(category.name)}`}
                className="w-full py-3 text-xs font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
              >
                Book Now
              </Link>
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 text-xs font-mono text-neutral-400">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                Minimum booking is 4 hours. Community creators set their own rates.
                The studio benchmark ensures fair pricing.
              </span>
            </div>
          </div>
        </div>

        {/* ── Back link ── */}
        <div className="mt-16 pt-8 border-t border-white/5">
          <Link
            href={`/studio/category/${category.slug}`}
            className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 hover:text-[#D4A843] transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {category.name}
          </Link>
        </div>
      </div>
    </div>
  );
}
