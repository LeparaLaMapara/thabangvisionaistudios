'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, Star, MapPin, Clock, Briefcase, ShieldCheck } from 'lucide-react';
import type { CrewMember, CrewPortfolioItem, CrewReview } from '@/lib/supabase/queries/crew';
import type { PortfolioProject } from '@/types/portfolio';

// ─── Active media discriminated union ─────────────────────────────────────────

type ActiveMedia =
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }
  | { type: 'none' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function CrewServiceDetailView({
  crew,
  portfolio,
  reviews,
}: {
  crew: CrewMember;
  portfolio: CrewPortfolioItem[];
  reviews: CrewReview[];
}) {
  const ownProjects: PortfolioProject[] = crew.portfolio_projects ?? [];

  // Collect all images: own portfolio first, then smart_productions
  const allImages = useMemo(() => {
    const imgs: { url: string; id: string; title: string }[] = [];
    // Own portfolio photos
    for (const p of ownProjects) {
      for (const photo of p.photos ?? []) {
        imgs.push({ url: photo.url, id: photo.public_id, title: p.title });
      }
    }
    // Smart productions portfolio
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

  // Collect all Cloudinary-hosted showreel videos (from own portfolio)
  const showreelVideos = useMemo(() => {
    return ownProjects
      .filter((p) => p.video?.url)
      .map((p) => ({ url: p.video!.url, title: p.title }));
  }, [ownProjects]);

  const [activeMedia, setActiveMedia] = useState<ActiveMedia>(
    heroImage
      ? { type: 'image', src: heroImage }
      : showreelVideos.length > 0
      ? { type: 'video', src: showreelVideos[0].url }
      : { type: 'none' },
  );

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
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link href="/smart-rentals" className="hover:text-white transition-colors">Smart Rentals</Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link href="/smart-rentals/crew-services" className="hover:text-white transition-colors">
              Crew Services
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
              <span className="text-[9px] font-mono font-bold text-emerald-400 uppercase tracking-widest">
                Verified Creator
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
                Crew Services / {primarySpec}
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
        <div className="grid lg:grid-cols-[1fr_420px] gap-12 xl:gap-20 items-start">

          {/* ── LEFT: Portfolio gallery ── */}
          <div>
            {/* Active media viewer */}
            <motion.div
              key={activeMedia.type === 'video' ? activeMedia.src : activeMedia.type === 'image' ? activeMedia.src : 'none'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="relative aspect-[4/3] overflow-hidden bg-neutral-900 mb-4"
            >
              {activeMedia.type === 'video' ? (
                /* Autoplay video with transparent overlay — blocks all clicks */
                <div className="absolute inset-0">
                  <video
                    src={activeMedia.src}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    loop
                    playsInline
                  />
                  {/* Transparent overlay: blocks all pointer events to prevent bypass */}
                  <div className="absolute inset-0 z-10" style={{ pointerEvents: 'all' }} />
                </div>
              ) : activeMedia.type === 'image' ? (
                <Image
                  src={activeMedia.src}
                  alt="Portfolio work"
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                    No portfolio yet
                  </span>
                </div>
              )}
            </motion.div>

            {/* Thumbnail strip */}
            {(allImages.length > 1 || showreelVideos.length > 0) && (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
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
                    <Image
                      src={img.url}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </button>
                ))}

                {showreelVideos.map((vid, i) => (
                  <button
                    key={`vid-${i}`}
                    onClick={() => setActiveMedia({ type: 'video', src: vid.url })}
                    aria-label={`Play showreel: ${vid.title}`}
                    className={`flex-shrink-0 w-20 h-20 overflow-hidden border-2 transition-all duration-200 relative bg-neutral-900 ${
                      activeMedia.type === 'video' && activeMedia.src === vid.url
                        ? 'border-[#D4A843]'
                        : 'border-transparent hover:border-white/30'
                    }`}
                  >
                    {heroImage && (
                      <Image src={heroImage} alt="" fill sizes="80px" className="object-cover opacity-40" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-black translate-x-0.5">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  </button>
                ))}
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
                      href={`/smart-production/${prod.slug}`}
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
                            unoptimized
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-[10px] font-mono text-neutral-500 uppercase">No image</span>
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-1">
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
                        <span className="text-[9px] font-mono text-neutral-500 border border-white/10 px-2 py-0.5 uppercase">
                          {project.project_type}
                        </span>
                      </div>

                      {/* Photos grid */}
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
                                unoptimized
                              />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Showreel — autoplay, muted, loop, transparent overlay */}
                      {project.video && (
                        <div className="relative aspect-video bg-neutral-900">
                          <video
                            src={project.video.url}
                            className="w-full h-full object-cover"
                            autoPlay
                            muted
                            loop
                            playsInline
                          />
                          {/* Transparent overlay: blocks all clicks */}
                          <div className="absolute inset-0 z-10" style={{ pointerEvents: 'all' }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Anonymous Reviews ── */}
            {reviews.length > 0 && (
              <div className="mt-12 pt-12 border-t border-white/5">
                <h2 className="text-2xl font-bold tracking-tight mb-8 border-l-2 border-[#D4A843] pl-4 uppercase">
                  Reviews
                </h2>
                <div className="space-y-6">
                  {reviews.map((review) => (
                    <div key={review.id} className="bg-[#0A0A0B] border border-white/5 p-6">
                      {/* Stars */}
                      <div className="flex items-center gap-1 mb-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`w-4 h-4 ${
                              i < review.rating ? 'text-[#D4A843] fill-[#D4A843]' : 'text-neutral-700'
                            }`}
                          />
                        ))}
                      </div>
                      {review.comment && (
                        <p className="text-sm text-neutral-300 leading-relaxed mb-3">
                          {review.comment}
                        </p>
                      )}
                      <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
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
                <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
                  Crew Services
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
                        i < Math.round(avgRating) ? 'text-[#D4A843] fill-[#D4A843]' : 'text-neutral-700'
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
                  <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                    Hourly Rate
                  </span>
                  <span className="text-2xl font-bold text-[#D4A843]">
                    ZAR {crew.hourly_rate.toLocaleString()}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-6 border border-dashed border-white/10 p-4">
                Contact for rates
              </p>
            )}

            {/* Details */}
            <div className="space-y-4 mb-8">
              {crew.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                  <span className="text-sm text-neutral-300">{crew.location}</span>
                </div>
              )}
              {crew.years_experience != null && (
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                  <span className="text-sm text-neutral-300">
                    {crew.years_experience} year{crew.years_experience !== 1 ? 's' : ''} experience
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Briefcase className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                <span className="text-sm text-neutral-300">
                  {portfolio.length} production{portfolio.length !== 1 ? 's' : ''} completed
                </span>
              </div>
            </div>

            {/* Specializations */}
            <div className="mb-8">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-4 border-b border-white/5 pb-3">
                Specializations
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {crew.specializations.map((spec) => (
                  <span
                    key={spec}
                    className="text-[9px] font-mono uppercase tracking-widest text-neutral-400 border border-white/10 px-2 py-1 bg-white/5"
                  >
                    {spec}
                  </span>
                ))}
              </div>
            </div>

            {/* Skills */}
            {crew.skills && crew.skills.length > 0 && (
              <div className="mb-8">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-4 border-b border-white/5 pb-3">
                  Skills
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {crew.skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 border border-white/5 px-2 py-1"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Book CTA — links to brief form */}
            <div className="border border-white/10 p-5 bg-[#0A0A0B]">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-4 border-b border-white/5 pb-3">
                Book This Creator
              </h3>
              <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                Identity is revealed after your booking is confirmed and paid. Submit a brief to get started.
              </p>
              <Link
                href="/smart-production#brief-form"
                className="w-full py-3 text-[10px] font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
              >
                Submit a Brief
              </Link>
            </div>
          </div>
        </div>

        {/* ── Back link ── */}
        <div className="mt-16 pt-8 border-t border-white/5">
          <Link
            href="/smart-rentals/crew-services"
            className="inline-flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 hover:text-[#D4A843] transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Crew Services
          </Link>
        </div>
      </div>
    </div>
  );
}
