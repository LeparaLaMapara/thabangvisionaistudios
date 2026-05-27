'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, Camera } from 'lucide-react';
import { PLACEHOLDER_IMAGES } from '@/lib/constants';
import type { ProductionCategory } from '@/types/production';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';

// ─── Image shimmer skeleton ───────────────────────────────────────────────────
function ImageSkeleton(): React.ReactElement {
  return (
    <div className="absolute inset-0 bg-neutral-900 animate-pulse">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]" />
    </div>
  );
}

// ─── Sequential reveal hook ───────────────────────────────────────────────────
function useSequentialReveal(total: number) {
  const [revealedCount, setRevealedCount] = useState(0);
  const loadedRef = useRef<Set<number>>(new Set());

  const tryRevealNext = useCallback(() => {
    setRevealedCount(prev => {
      let next = prev;
      while (loadedRef.current.has(next)) next++;
      return next;
    });
  }, []);

  const onImageLoaded = useCallback((index: number) => {
    loadedRef.current.add(index);
    tryRevealNext();
  }, [tryRevealNext]);

  useEffect(() => {
    if (revealedCount < total && loadedRef.current.has(revealedCount)) {
      const timer = setTimeout(tryRevealNext, 150);
      return () => clearTimeout(timer);
    }
  }, [revealedCount, total, tryRevealNext]);

  const isRevealed = useCallback(
    (index: number) => index < revealedCount,
    [revealedCount],
  );

  return { onImageLoaded, isRevealed };
}

// ─── Category metadata (fallback images) ─────────────────────────────────────

const FALLBACK_IMAGES: Record<string, string> = {
  photography: PLACEHOLDER_IMAGES.camerasOptics,
  'video-production': PLACEHOLDER_IMAGES.gripMotion,
  'weddings-ceremonies': PLACEHOLDER_IMAGES.specializedSolutions,
  'event-coverage': PLACEHOLDER_IMAGES.lightingPower,
  'content-creation': PLACEHOLDER_IMAGES.dataStorage,
  'corporate-brand': PLACEHOLDER_IMAGES.audio,
};

const CATEGORY_SUBTITLES: Record<string, string> = {
  photography: 'Portraits, Product & Editorial',
  'video-production': 'Music Videos, Docs & Short Films',
  'weddings-ceremonies': 'Photo + Video Packages',
  'event-coverage': 'Corporate, Launches & Festivals',
  'content-creation': 'Social Media & Brand Content',
  'corporate-brand': 'Headshots, Culture & Brand Films',
};

// ─── Category Card ────────────────────────────────────────────────────────────

function CategoryCard({
  category,
  index,
  productionCount,
  revealed,
  onImageReady,
}: {
  category: ProductionCategory;
  index: number;
  productionCount: number;
  revealed: boolean;
  onImageReady: () => void;
}): React.ReactElement {
  const onLoad = useCallback(() => onImageReady(), [onImageReady]);
  const imageUrl = category.coverImageUrl || FALLBACK_IMAGES[category.slug] || PLACEHOLDER_IMAGES.camerasOptics;
  const subtitle = CATEGORY_SUBTITLES[category.slug] || category.subTypes.slice(0, 3).join(', ');

  return (
    <div className="relative h-[450px] overflow-hidden bg-[#0A0A0B]">
      {!revealed && <ImageSkeleton />}

      <Image
        src={imageUrl}
        alt={category.name}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover opacity-0 pointer-events-none absolute"
        onLoad={onLoad}
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={revealed ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="absolute inset-0 group cursor-pointer"
      >
        <Link href={`/studio/category/${category.slug}`} className="block w-full h-full relative">
          <div className="absolute inset-0 z-10 bg-black/30 md:bg-black/60 group-hover:bg-black/30 transition-colors duration-500" />

          <Image
            src={imageUrl}
            alt={category.name}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700 ease-out"
              />

          <div className="absolute inset-0 z-20 flex flex-col justify-between p-8">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-mono text-white/70 group-hover:text-white transition-colors">
                0{index + 1}
              </span>
              <ArrowUpRight className="text-white opacity-0 -translate-y-2 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 w-5 h-5" />
            </div>
            <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
              <h3 className="text-2xl font-display font-medium tracking-wide text-white uppercase mb-2">
                {category.name}
              </h3>
              <p className="text-xs font-mono text-white/60 uppercase tracking-widest mb-1">
                {subtitle}
              </p>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-mono text-[#D4A843]">
                  from R{category.startingRate.toLocaleString('en-ZA')}/{category.startingUnit}
                </span>
                {productionCount > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-white/40">
                    <Camera className="w-3 h-3" />
                    {productionCount} project{productionCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100 leading-relaxed border-t border-white/20 pt-4">
                {category.description}
              </p>
            </div>
          </div>
        </Link>
      </motion.div>
    </div>
  );
}

// ─── Featured Production Card ─────────────────────────────────────────────────

function FeaturedProductionCard({ production }: { production: SmartProduction }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const imageUrl = production.thumbnail_url || production.gallery?.[0]?.url;

  if (!imageUrl) return null;

  return (
    <Link
      href={`/studio/${production.slug}`}
      className="group block relative aspect-[3/4] overflow-hidden bg-[#0A0A0B] border border-white/5 hover:border-[#D4A843]/30 transition-colors"
    >
      {!imgLoaded && <ImageSkeleton />}
      <Image
        src={imageUrl}
        alt={production.title}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
        className={`object-cover grayscale group-hover:grayscale-0 transition-all duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setImgLoaded(true)}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />
      <div className="absolute bottom-0 left-0 right-0 p-4 z-20">
        <p className="text-[9px] font-mono text-[#D4A843] uppercase tracking-widest mb-1">
          {production.project_type} {production.year && `· ${production.year}`}
        </p>
        <h4 className="text-sm font-display font-medium text-white group-hover:text-[#D4A843] transition-colors line-clamp-2">
          {production.title}
        </h4>
        {production.client && (
          <p className="text-[10px] font-mono text-neutral-500 mt-1">{production.client}</p>
        )}
      </div>
    </Link>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  categories: ProductionCategory[];
  productionCounts: Record<string, number>;
  featuredProductions: SmartProduction[];
}

export default function SmartProductionClient({ categories, productionCounts, featuredProductions }: Props) {
  const { onImageLoaded, isRevealed } = useSequentialReveal(categories.length);

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">

      {/* ── Header ── */}
      <div className="container mx-auto px-6 mb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="border-l border-white/20 pl-8 md:pl-16 py-4">
            <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block">
              01 // Production Services
            </span>
            <h1 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tight leading-[0.9] mb-8 uppercase">
              Our <br />
              <span className="text-neutral-500">Studio</span>
            </h1>
            <p className="max-w-2xl text-lg text-neutral-300 font-light leading-relaxed">
              Hire trusted photographers, videographers, and production teams from our in-house studio or verified creator network.
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── Category Grid ── */}
      <section className="relative bg-[#050505] border-t border-white/5">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <div className="container mx-auto px-6 py-12 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/10 border border-white/10">
            {categories.map((cat, index) => (
              <CategoryCard
                key={cat.slug}
                category={cat}
                index={index}
                productionCount={productionCounts[cat.projectType] ?? 0}
                revealed={isRevealed(index)}
                onImageReady={() => onImageLoaded(index)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured Productions ── */}
      {featuredProductions.length > 0 && (
        <section className="container mx-auto px-6 mt-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-end justify-between mb-8">
              <div>
                <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-2 block">
                  02 // Portfolio
                </span>
                <h2 className="text-3xl md:text-5xl font-display font-medium text-white uppercase tracking-tight">
                  Featured Work
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {featuredProductions.map((prod) => (
                <FeaturedProductionCard key={prod.id} production={prod} />
              ))}
            </div>
          </motion.div>
        </section>
      )}
    </div>
  );
}
