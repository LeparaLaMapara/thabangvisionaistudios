'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { PRODUCTION_CATEGORIES, PLACEHOLDER_IMAGES } from '@/lib/constants';

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

// ─── Category metadata ────────────────────────────────────────────────────────

type CategoryMeta = {
  label: string;
  subtitle: string;
  description: string;
  fallbackImage: string;
};

const CATEGORY_META: Record<string, CategoryMeta> = {
  photography: {
    label: 'Photography',
    subtitle: 'Portraits, Product & Editorial',
    description: 'Professional photo sessions for portraits, products, fashion, and real estate.',
    fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
  },
  'video-production': {
    label: 'Video Production',
    subtitle: 'Music Videos, Docs & Short Films',
    description: 'Cinematic video from music videos to documentaries and short films.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  'weddings-ceremonies': {
    label: 'Weddings & Ceremonies',
    subtitle: 'Photo + Video Packages',
    description: 'Full coverage for weddings, lobola, matric dances, and celebrations.',
    fallbackImage: PLACEHOLDER_IMAGES.specializedSolutions,
  },
  'event-coverage': {
    label: 'Event Coverage',
    subtitle: 'Corporate, Launches & Festivals',
    description: 'Capture every moment at corporate events, product launches, and festivals.',
    fallbackImage: PLACEHOLDER_IMAGES.lightingPower,
  },
  'content-creation': {
    label: 'Content Creation',
    subtitle: 'Social Media & Brand Content',
    description: 'Social media, YouTube, and brand content optimized for engagement.',
    fallbackImage: PLACEHOLDER_IMAGES.dataStorage,
  },
  'corporate-brand': {
    label: 'Corporate & Brand',
    subtitle: 'Headshots, Culture & Brand Films',
    description: 'Team headshots, office culture, product photography, and brand films.',
    fallbackImage: PLACEHOLDER_IMAGES.audio,
  },
};

function getCategoryMeta(slug: string): CategoryMeta {
  return CATEGORY_META[slug] ?? {
    label: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    subtitle: 'Production Services',
    description: '',
    fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
  };
}

// ─── Category Card ────────────────────────────────────────────────────────────

function CategoryCard({
  slug,
  meta,
  index,
  startingRate,
  revealed,
  onImageReady,
}: {
  slug: string;
  meta: CategoryMeta;
  index: number;
  startingRate: number;
  revealed: boolean;
  onImageReady: () => void;
}): React.ReactElement {
  const onLoad = useCallback(() => onImageReady(), [onImageReady]);

  return (
    <div className="relative h-[450px] overflow-hidden bg-[#0A0A0B]">
      {!revealed && <ImageSkeleton />}

      <Image
        src={meta.fallbackImage}
        alt={meta.label}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover opacity-0 pointer-events-none absolute"
        onLoad={onLoad}
        unoptimized
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={revealed ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="absolute inset-0 group cursor-pointer"
      >
        <Link href={`/smart-production/category/${slug}`} className="block w-full h-full relative">
          <div className="absolute inset-0 z-10 bg-black/30 md:bg-black/60 group-hover:bg-black/30 transition-colors duration-500" />

          <Image
            src={meta.fallbackImage}
            alt={meta.label}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700 ease-out"
            unoptimized
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
                {meta.label}
              </h3>
              <p className="text-xs font-mono text-white/60 uppercase tracking-widest mb-4">
                {meta.subtitle}
                <span className="ml-2 text-[#D4A843]">
                  from R{startingRate.toLocaleString('en-ZA')}/hr
                </span>
              </p>
              <p className="text-sm text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100 leading-relaxed border-t border-white/20 pt-4">
                {meta.description}
              </p>
            </div>
          </div>
        </Link>
      </motion.div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SmartProductionClient() {
  const categories = PRODUCTION_CATEGORIES;
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
              Smart <br />
              <span className="text-neutral-500">Productions</span>
            </h1>
            <p className="max-w-2xl text-lg text-neutral-300 font-light leading-relaxed">
              Book production services from our in-house studio team or verified community creators.
              Studio sets the benchmark. Community brings the range.
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
                slug={cat.slug}
                meta={getCategoryMeta(cat.slug)}
                index={index}
                startingRate={cat.startingRate}
                revealed={isRevealed(index)}
                onImageReady={() => onImageLoaded(index)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
