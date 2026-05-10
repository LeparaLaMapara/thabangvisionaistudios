'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ArrowRight, SlidersHorizontal, X, Star,
} from 'lucide-react';
import type { ProductionCategory } from '@/types/production';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';
import { formatZAR } from '@/lib/productions/pricing';

// ─── Types ──────────────────────────────────────────────────────────────────

type ServiceFilter = 'all' | 'photography' | 'video';
type SortOption = 'newest' | 'price-low' | 'price-high';

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

function classifyProjectType(projectType: string): 'photography' | 'video' {
  const lower = projectType.toLowerCase();
  if (lower.includes('video') || lower.includes('film') || lower.includes('cinema') || lower.includes('documentary') || lower.includes('music_video') || lower.includes('commercial')) {
    return 'video';
  }
  return 'photography';
}

function priceLabel(unit: string): string {
  switch (unit) {
    case 'hour': return '/hr';
    case 'session': return '/session';
    case 'event': return '/event';
    case 'project':
    default: return '';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  category: ProductionCategory;
  productions: SmartProduction[];
}

export default function ProductionCategoryClient({ category, productions }: Props) {
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    let result = productions;

    if (serviceFilter !== 'all') {
      result = result.filter(p => classifyProjectType(p.project_type) === serviceFilter);
    }

    switch (sortBy) {
      case 'price-low':
        result = [...result].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        break;
      case 'price-high':
        result = [...result].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        break;
      case 'newest':
      default:
        result = [...result].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    }

    return result;
  }, [productions, serviceFilter, sortBy]);

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
            {(['all', 'photography', 'video'] as ServiceFilter[]).map(filter => (
              <button
                key={filter}
                onClick={() => setServiceFilter(filter)}
                className={`text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-full transition-colors ${
                  serviceFilter === filter
                    ? 'bg-[#D4A843]/10 text-[#D4A843] border border-[#D4A843]/30'
                    : 'text-neutral-500 border border-white/10 hover:text-white hover:border-white/20'
                }`}
              >
                {filter === 'all' ? 'All' : filter === 'photography' ? 'Photography' : 'Video'}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Controls bar */}
        <div className="flex items-center justify-between mb-8">
          <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
            {filtered.length} production{filtered.length !== 1 ? 's' : ''}
          </p>

          <div className="flex items-center gap-3">
            {/* Sort */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="appearance-none bg-transparent border border-white/10 text-[10px] font-mono text-neutral-400 uppercase tracking-wider px-3 py-1.5 pr-8 rounded cursor-pointer hover:border-white/20"
              >
                <option value="newest">Newest</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
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
            {filtered.map((production) => (
              <motion.div
                key={production.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                <ProductionCard production={production} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {filtered.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-neutral-500 font-mono text-sm">No productions match this filter.</p>
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
                  <p className="text-[9px] font-mono uppercase text-neutral-500">Type</p>
                  <div className="flex gap-2">
                    {(['all', 'photography', 'video'] as ServiceFilter[]).map(filter => (
                      <button
                        key={filter}
                        onClick={() => { setServiceFilter(filter); setMobileFiltersOpen(false); }}
                        className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded-full ${
                          serviceFilter === filter
                            ? 'bg-[#D4A843]/10 text-[#D4A843] border border-[#D4A843]/30'
                            : 'text-neutral-500 border border-white/10'
                        }`}
                      >
                        {filter === 'all' ? 'All' : filter}
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

// ─── Production Card (marketplace item) ─────────────────────────────────────

function ProductionCard({ production }: { production: SmartProduction }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const onLoad = useCallback(() => setImgLoaded(true), []);

  const imgUrl = production.thumbnail_url || production.gallery?.[0]?.url;
  const hasPrice = production.price != null && production.price > 0;
  const galleryCount = production.gallery?.length ?? 0;
  const hasVideo = !!production.video_url;

  return (
    <Link
      href={`/smart-production/${production.slug}`}
      className="group relative bg-[#0A0A0B] border border-white/5 hover:border-white/20 transition-all duration-300 flex flex-col overflow-hidden"
    >
      {/* Status badges */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-1.5">
        {production.is_featured && (
          <span className="flex items-center gap-1 bg-[#D4A843] text-black text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            <Star className="w-2.5 h-2.5" />
            Featured
          </span>
        )}
        {production.sub_category && (
          <span className="bg-white/10 backdrop-blur-md text-white text-[9px] font-mono font-bold px-2 py-0.5 uppercase tracking-widest">
            {production.sub_category}
          </span>
        )}
      </div>

      {/* Gallery / video count badge */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
        {galleryCount > 0 && (
          <span className="text-[9px] font-mono text-white/80 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full">
            {galleryCount} photo{galleryCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasVideo && (
          <span className="text-[9px] font-mono text-white/80 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full">
            Video
          </span>
        )}
      </div>

      {/* Thumbnail */}
      <div className="relative aspect-square overflow-hidden bg-neutral-900">
        {imgUrl ? (
          <>
            {!imgLoaded && <ImageSkeleton />}
            <Image
              src={cloudinaryThumb(imgUrl)}
              alt={production.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className={`object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 scale-95 group-hover:scale-105 transition-all duration-700 ease-out ${
                imgLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={onLoad}
              unoptimized
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
          {production.project_type && (
            <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-1">
              {production.project_type.replace(/_/g, ' ')}
            </div>
          )}
          <h3 className="text-lg font-display font-medium text-white uppercase leading-tight mb-3 group-hover:underline decoration-1 underline-offset-4">
            {production.title}
          </h3>

          {production.tags && production.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {production.tags.slice(0, 3).map((tag, i) => (
                <span
                  key={i}
                  className="text-[9px] font-mono text-neutral-400 border border-white/10 px-1.5 py-0.5 bg-white/5 uppercase"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          {/* Price */}
          {hasPrice ? (
            <div className="flex items-end gap-1 mb-4">
              <span className="text-sm font-bold text-white">
                {production.currency ?? 'ZAR'} {production.price!.toLocaleString('en-ZA')}
              </span>
              <span className="text-[10px] text-neutral-500 mb-0.5">
                {priceLabel(production.price_unit)}
              </span>
            </div>
          ) : (
            <p className="text-[10px] font-mono text-neutral-500 mb-4 uppercase tracking-widest">
              Contact for pricing
            </p>
          )}

          {/* CTA */}
          <Link
            href={`/smart-production/${production.slug}`}
            className="w-full py-3 text-[10px] font-mono font-bold uppercase tracking-widest transition-all bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 flex items-center justify-center gap-2"
          >
            View Details
            <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </Link>
  );
}
