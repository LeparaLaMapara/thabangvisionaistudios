'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';
import { PLACEHOLDER_IMAGES, RENTAL_CATEGORIES } from '@/lib/constants';

// ─── Image shimmer skeleton ───────────────────────────────────────────────────
function ImageSkeleton(): React.ReactElement {
  return (
    <div className="absolute inset-0 bg-neutral-900 animate-pulse">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite]" />
    </div>
  );
}

// ─── Sequential reveal hook ───────────────────────────────────────────────────
// Tracks which images have loaded and reveals cards one by one in order.
function useSequentialReveal(total: number): {
  onImageLoaded: (index: number) => void;
  isRevealed: (index: number) => boolean;
} {
  const [revealedCount, setRevealedCount] = useState(0);
  const loadedRef = useRef<Set<number>>(new Set());

  const tryRevealNext = useCallback(() => {
    setRevealedCount(prev => {
      let next = prev;
      while (loadedRef.current.has(next)) {
        next++;
      }
      return next;
    });
  }, []);

  const onImageLoaded = useCallback((index: number) => {
    loadedRef.current.add(index);
    tryRevealNext();
  }, [tryRevealNext]);

  // Re-check the queue after each reveal in case later cards already loaded
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

// ─── Category card: fades in only when it is next in the sequence ─────────────
function CategoryCard({
  cat,
  meta,
  index,
  count,
  revealed,
  onImageReady,
}: {
  cat: string;
  meta: { label: string; subtitle: string; description: string; fallbackImage: string };
  index: number;
  count: number | undefined;
  revealed: boolean;
  onImageReady: () => void;
}): React.ReactElement {
  const onLoad = useCallback(() => onImageReady(), [onImageReady]);

  return (
    <div className="relative h-[450px] overflow-hidden bg-[#0A0A0B]">
      {/* Skeleton shown while waiting for this card's turn */}
      {!revealed && <ImageSkeleton />}

      {/* Hidden preload image that fires onLoad when ready */}
      <Image
        src={meta.fallbackImage}
        alt={meta.label}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover opacity-0 pointer-events-none absolute"
        onLoad={onLoad}
        unoptimized
      />

      {/* Full card fades in when revealed */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={revealed ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="absolute inset-0 group cursor-pointer"
      >
        <Link href={`/rentals/${cat}`} className="block w-full h-full relative">
          <div className="absolute inset-0 z-10 bg-black/20 md:bg-black/40 dark:bg-black/30 dark:md:bg-black/60 group-hover:bg-black/20 dark:group-hover:bg-black/30 transition-colors duration-500" />

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
                {count != null && (
                  <span className="ml-2 text-white/40">
                    | {count} item{count !== 1 ? 's' : ''}
                  </span>
                )}
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

// ─── Category display metadata ────────────────────────────────────────────────
// Maps DB category slugs to display info.
// Category images are fixed brand images from PLACEHOLDER_IMAGES. Never overridden by rental thumbnails.

type CategoryMeta = {
  label: string;
  subtitle: string;
  description: string;
  fallbackImage: string;
};

const CATEGORY_META: Record<string, CategoryMeta> = Object.fromEntries(
  RENTAL_CATEGORIES.map(c => [c.value, { label: c.label, subtitle: c.subtitle, description: c.description, fallbackImage: c.fallbackImage }]),
);

function getCategoryMeta(slug: string): CategoryMeta {
  return (
    CATEGORY_META[slug] ?? {
      label:         slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      subtitle:      'Equipment',
      description:   '',
      fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
    }
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SmartRentalsClient({ rentals }: { rentals: SmartRental[] }) {
  // Derive unique categories from live DB data. Order preserved by first occurrence.
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rentals) {
      if (r.category && !seen.has(r.category)) {
        seen.add(r.category);
        out.push(r.category);
      }
    }
    return out;
  }, [rentals]);

  // Item count per category
  const categoryCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rentals) {
      if (r.category) {
        map[r.category] = (map[r.category] ?? 0) + 1;
      }
    }
    return map;
  }, [rentals]);

  // Sequential reveal: cards appear one by one in order as images finish loading
  const { onImageLoaded, isRevealed } = useSequentialReveal(categories.length);

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20 transition-colors duration-500">

      {/* ── Header ── */}
      <div className="container mx-auto px-6 mb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="border-l border-black/20 dark:border-white/20 pl-8 md:pl-16 py-4">
            <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block">
              02 // Equipment Fleet
            </span>
            <h1 className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tight leading-[0.9] mb-8 uppercase">
              Professional Gear <br />
              <span className="text-neutral-400 dark:text-neutral-500">For Every Shoot</span>
            </h1>
            <p className="max-w-2xl text-lg text-neutral-600 dark:text-neutral-300 font-light leading-relaxed">
              Rent professional cameras, lenses, lighting, audio equipment, drones, and studio gear from verified creators across South Africa. Secure bookings, insured rentals, and trusted equipment. All in one platform.
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── Category Grid ── */}
      <section className="relative bg-neutral-50 dark:bg-[#050505] border-t border-black/5 dark:border-white/5">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <div className="container mx-auto px-6 py-12 relative z-10">

          {categories.length === 0 ? (
            /* Empty state. No published rentals yet. */
            <div className="py-32 text-center">
              <p className="text-neutral-500 dark:text-neutral-600 font-mono text-sm uppercase tracking-widest">
                Professional Equipment for Every Production
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10">

              {/* Category cards revealed sequentially in order */}
              {categories.map((cat, index) => (
                <CategoryCard
                  key={cat}
                  cat={cat}
                  meta={getCategoryMeta(cat)}
                  index={index}
                  count={categoryCount[cat]}
                  revealed={isRevealed(index)}
                  onImageReady={() => onImageLoaded(index)}
                />
              ))}

            </div>
          )}
        </div>
      </section>

    </div>
  );
}
