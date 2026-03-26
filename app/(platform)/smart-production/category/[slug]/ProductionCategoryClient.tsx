'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  SlidersHorizontal, X, Star, ShieldCheck, Building2, Users, ArrowRight, ChevronDown,
} from 'lucide-react';
import type { ProductionCategory } from '@/types/production';
import type { CrewMember } from '@/lib/supabase/queries/crew';
import { PRODUCTION_PACKAGES, PRODUCTION_SERVICES } from '@/lib/constants';
import { formatZAR } from '@/lib/productions/pricing';

// ─── Types ──────────────────────────────────────────────────────────────────

type ServiceFilter = 'all' | 'photography' | 'video' | 'both';
type SourceFilter = 'all' | 'studio' | 'community';
type SortOption = 'recommended' | 'price-low' | 'price-high' | 'rating';

interface StudioPackageCard {
  kind: 'studio';
  id: string;
  name: string;
  description: string;
  hourlyRate: number;
  totalHours: number;
  totalPrice: number;
  deliverables: string[];
  popular?: boolean;
  serviceType: ServiceFilter;
}

interface CommunityCreatorCard {
  kind: 'community';
  id: string;
  slug: string;
  hourlyRate: number;
  specializations: string[];
  yearsExperience: number | null;
  location: string | null;
  reviewCount: number;
  averageRating: number;
  portfolioImage: string | null;
  hasVideo: boolean;
  photoCount: number;
  serviceType: ServiceFilter;
}

type ListingCard = StudioPackageCard | CommunityCreatorCard;

// ─── Helpers ────────────────────────────────────────────────────────────────

function cloudinaryThumb(url: string, w = 600): string {
  if (!url.includes('cloudinary.com')) return url;
  return url.replace('/upload/', `/upload/w_${w},c_fill,f_auto,q_auto/`);
}

function ImageSkeleton() {
  return (
    <div className="absolute inset-0 bg-neutral-900 animate-pulse">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]" />
    </div>
  );
}

function classifyCreatorService(specializations: string[]): ServiceFilter {
  const lower = specializations.map(s => s.toLowerCase());
  const hasPhoto = lower.some(s => s.includes('photo') || s.includes('portrait') || s.includes('headshot'));
  const hasVideo = lower.some(s => s.includes('video') || s.includes('cinema') || s.includes('film') || s.includes('documentary'));
  if (hasPhoto && hasVideo) return 'both';
  if (hasVideo) return 'video';
  return 'photography';
}

function classifyPackageService(pkg: { services: { type: string }[] }): ServiceFilter {
  const hasPhoto = pkg.services.some(s => s.type === 'photography');
  const hasVideo = pkg.services.some(s => s.type === 'cinematography');
  if (hasPhoto && hasVideo) return 'both';
  if (hasVideo) return 'video';
  return 'photography';
}

function calculatePackagePrice(services: { type: string; subType: string; hours: number }[]): { hourlyRate: number; totalHours: number; totalPrice: number } {
  let total = 0;
  let totalHours = 0;
  for (const s of services) {
    const category = PRODUCTION_SERVICES[s.type as keyof typeof PRODUCTION_SERVICES];
    if (category && typeof category === 'object' && s.subType in category) {
      const svc = (category as Record<string, { rate: number }>)[s.subType];
      total += svc.rate * s.hours;
      totalHours += s.hours;
    }
  }
  const hourlyRate = totalHours > 0 ? Math.round(total / totalHours) : 0;
  return { hourlyRate, totalHours, totalPrice: total };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  category: ProductionCategory;
  crew: CrewMember[];
}

export default function ProductionCategoryClient({ category, crew }: Props) {
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recommended');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // ─── Build unified listing cards ────────────────────────────────────────────

  const listings = useMemo<ListingCard[]>(() => {
    const cards: ListingCard[] = [];

    // Studio packages for this category
    const categoryPackages = PRODUCTION_PACKAGES.filter(p => p.category === category.slug);
    for (const pkg of categoryPackages) {
      const { hourlyRate, totalHours, totalPrice } = calculatePackagePrice(pkg.services);
      cards.push({
        kind: 'studio',
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        hourlyRate,
        totalHours,
        totalPrice,
        deliverables: pkg.deliverables,
        popular: pkg.popular,
        serviceType: classifyPackageService(pkg),
      });
    }

    // Community creators
    for (const c of crew) {
      const firstImage = c.portfolio_projects?.[0]?.photos?.[0]?.url ?? null;

      const hasVideo = c.portfolio_projects?.some(p => p.video !== null) ?? false;
      const photoCount = c.portfolio_projects?.reduce((sum, p) => sum + p.photos.length, 0) ?? 0;

      cards.push({
        kind: 'community',
        id: c.id,
        slug: c.crew_slug ?? c.id,
        hourlyRate: c.hourly_rate ?? 0,
        specializations: c.specializations ?? [],
        yearsExperience: c.years_experience,
        location: c.location,
        reviewCount: 0, // TODO: wire to reviews
        averageRating: 0,
        portfolioImage: firstImage,
        hasVideo,
        photoCount,
        serviceType: classifyCreatorService(c.specializations ?? []),
      });
    }

    return cards;
  }, [category.slug, crew]);

  // ─── Filter + Sort ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = listings;

    if (serviceFilter !== 'all') {
      result = result.filter(c => c.serviceType === serviceFilter || c.serviceType === 'both');
    }
    if (sourceFilter !== 'all') {
      result = result.filter(c => c.kind === sourceFilter);
    }

    switch (sortBy) {
      case 'price-low':
        result = [...result].sort((a, b) => a.hourlyRate - b.hourlyRate);
        break;
      case 'price-high':
        result = [...result].sort((a, b) => b.hourlyRate - a.hourlyRate);
        break;
      case 'rating':
        result = [...result].sort((a, b) => {
          const rA = a.kind === 'community' ? a.averageRating : 5;
          const rB = b.kind === 'community' ? b.averageRating : 5;
          return rB - rA;
        });
        break;
      case 'recommended':
      default:
        // Studio first, then by rating
        result = [...result].sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'studio' ? -1 : 1;
          return 0;
        });
    }

    return result;
  }, [listings, serviceFilter, sourceFilter, sortBy]);

  const studioCount = listings.filter(c => c.kind === 'studio').length;
  const communityCount = listings.filter(c => c.kind === 'community').length;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6">

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-8">
          <Link href="/" className="hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <Link href="/smart-production" className="hover:text-white transition-colors">Smart Productions</Link>
          <span>/</span>
          <span className="text-[#D4A843]">{category.name}</span>
        </div>

        {/* Category Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <h1 className="text-4xl md:text-6xl font-display font-medium text-white uppercase tracking-tight mb-4">
            {category.name}
          </h1>
          <p className="text-neutral-400 max-w-2xl text-sm leading-relaxed mb-6">
            {category.description}
          </p>

          {/* Service type filter pills */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'photography', 'video', 'both'] as ServiceFilter[]).map(filter => (
              <button
                key={filter}
                onClick={() => setServiceFilter(filter)}
                className={`text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-full transition-colors ${
                  serviceFilter === filter
                    ? 'bg-[#D4A843]/10 text-[#D4A843] border border-[#D4A843]/30'
                    : 'text-neutral-500 border border-white/10 hover:text-white hover:border-white/20'
                }`}
              >
                {filter === 'all' ? 'All' : filter === 'both' ? 'Photo + Video' : filter === 'photography' ? 'Photography' : 'Video'}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Controls bar */}
        <div className="flex items-center justify-between mb-8">
          <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            {studioCount > 0 && ` · ${studioCount} studio`}
            {communityCount > 0 && ` · ${communityCount} community`}
          </p>

          <div className="flex items-center gap-3">
            {/* Source filter */}
            <div className="hidden md:flex items-center gap-2">
              {(['all', 'studio', 'community'] as SourceFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className={`text-[9px] font-mono uppercase tracking-wider px-3 py-1 rounded transition-colors ${
                    sourceFilter === s
                      ? 'bg-white/10 text-white'
                      : 'text-neutral-600 hover:text-neutral-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Sort */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="appearance-none bg-transparent border border-white/10 text-[10px] font-mono text-neutral-400 uppercase tracking-wider px-3 py-1.5 pr-8 rounded cursor-pointer hover:border-white/20"
              >
                <option value="recommended">Recommended</option>
                <option value="price-low">Price: Low → High</option>
                <option value="price-high">Price: High → Low</option>
                <option value="rating">Top Rated</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500 pointer-events-none" />
            </div>

            {/* Mobile filter */}
            <button
              className="md:hidden p-2 border border-white/10 rounded"
              onClick={() => setMobileFiltersOpen(true)}
            >
              <SlidersHorizontal className="w-4 h-4 text-neutral-400" />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((card) => (
              <motion.div
                key={card.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                {card.kind === 'studio' ? (
                  <StudioCard card={card} categorySlug={category.slug} />
                ) : (
                  <CreatorCard card={card} categorySlug={category.slug} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {filtered.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-neutral-500 font-mono text-sm">No results for this filter.</p>
          </div>
        )}

        {/* Mobile filter modal */}
        <AnimatePresence>
          {mobileFiltersOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm md:hidden"
              onClick={() => setMobileFiltersOpen(false)}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30 }}
                className="absolute bottom-0 left-0 right-0 bg-[#0A0A0B] border-t border-white/10 p-6 pb-[env(safe-area-inset-bottom)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-6">
                  <p className="text-xs font-mono uppercase text-white">Filters</p>
                  <button onClick={() => setMobileFiltersOpen(false)}>
                    <X className="w-5 h-5 text-neutral-400" />
                  </button>
                </div>

                <div className="space-y-4">
                  <p className="text-[9px] font-mono uppercase text-neutral-500">Source</p>
                  <div className="flex gap-2">
                    {(['all', 'studio', 'community'] as SourceFilter[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setSourceFilter(s)}
                        className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded-full ${
                          sourceFilter === s
                            ? 'bg-[#D4A843]/10 text-[#D4A843] border border-[#D4A843]/30'
                            : 'text-neutral-500 border border-white/10'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Studio Package Card ────────────────────────────────────────────────────

function StudioCard({ card, categorySlug }: { card: StudioPackageCard; categorySlug: string }) {
  return (
    <Link
      href={`/smart-production/category/${categorySlug}/${card.id}`}
      className="group block bg-[#0A0A0B] border border-white/5 hover:border-[#D4A843]/30 transition-all duration-300 overflow-hidden"
    >
      {/* Gold accent bar */}
      <div className="h-1 bg-[#D4A843]" />

      <div className="p-5">
        {/* Badges */}
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#D4A843] bg-[#D4A843]/10 px-2 py-0.5 rounded-full">
            <Building2 className="w-3 h-3" />
            Studio
          </span>
          {card.popular && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
              Popular
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-sm font-display font-medium text-white uppercase mb-1 group-hover:text-[#D4A843] transition-colors">
          {card.name}
        </h3>
        <p className="text-[10px] font-mono text-neutral-500 mb-4">
          {card.description}
        </p>

        {/* Deliverables */}
        <div className="space-y-1 mb-4">
          {card.deliverables.slice(0, 3).map((d, i) => (
            <p key={i} className="text-[10px] font-mono text-neutral-400 flex items-start gap-1.5">
              <span className="text-[#D4A843] mt-0.5">·</span>
              {d}
            </p>
          ))}
        </div>

        {/* Pricing */}
        <div className="flex items-end justify-between border-t border-white/5 pt-3">
          <div>
            <p className="text-lg font-display font-bold text-[#D4A843]">
              {formatZAR(card.totalPrice)}
            </p>
            <p className="text-[9px] font-mono text-neutral-500">
              {card.totalHours}hrs · ~{formatZAR(card.hourlyRate)}/hr
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-neutral-500 group-hover:text-[#D4A843] group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </Link>
  );
}

// ─── Community Creator Card ─────────────────────────────────────────────────

function CreatorCard({ card, categorySlug }: { card: CommunityCreatorCard; categorySlug: string }) {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <Link
      href={`/smart-production/category/${categorySlug}/${card.slug}`}
      className="group block bg-[#0A0A0B] border border-white/5 hover:border-white/20 transition-all duration-300 overflow-hidden"
    >
      {/* Portfolio image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-neutral-900">
        {!imgLoaded && <ImageSkeleton />}
        {card.portfolioImage && (
          <Image
            src={cloudinaryThumb(card.portfolioImage)}
            alt="Portfolio work"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className={`object-cover grayscale group-hover:grayscale-0 transition-all duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImgLoaded(true)}
            unoptimized
          />
        )}

        {/* Overlay badges */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
          <span className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-emerald-400 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full">
            <Users className="w-3 h-3" />
            Community
          </span>
          <span className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-emerald-400 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full">
            <ShieldCheck className="w-3 h-3" />
            Verified
          </span>
        </div>

        {/* Photo/video count */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
          {card.photoCount > 0 && (
            <span className="text-[9px] font-mono text-white/80 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full">
              {card.photoCount} photos
            </span>
          )}
          {card.hasVideo && (
            <span className="text-[9px] font-mono text-white/80 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full">
              Showreel
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        {/* Specialization as title */}
        <h3 className="text-xs font-display font-medium text-white uppercase mb-1 group-hover:text-[#D4A843] transition-colors">
          {card.specializations[0] ?? 'Creator'}
        </h3>

        <div className="flex items-center gap-2 text-[9px] font-mono text-neutral-500 mb-3">
          {card.location && <span>{card.location}</span>}
          {card.yearsExperience && <span>· {card.yearsExperience}yr exp</span>}
        </div>

        {/* Rating */}
        {card.reviewCount > 0 && (
          <div className="flex items-center gap-1 mb-3">
            <Star className="w-3 h-3 text-[#D4A843] fill-[#D4A843]" />
            <span className="text-[10px] font-mono text-white">{card.averageRating.toFixed(1)}</span>
            <span className="text-[10px] font-mono text-neutral-500">({card.reviewCount})</span>
          </div>
        )}

        {/* Pricing */}
        <div className="flex items-end justify-between border-t border-white/5 pt-3">
          <div>
            <p className="text-lg font-display font-bold text-white">
              {formatZAR(card.hourlyRate)}
              <span className="text-[10px] font-mono text-neutral-500 ml-1">/hr</span>
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-neutral-500 group-hover:text-[#D4A843] group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </Link>
  );
}
