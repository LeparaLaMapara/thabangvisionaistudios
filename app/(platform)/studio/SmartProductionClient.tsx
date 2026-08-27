'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { Camera } from 'lucide-react';
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

// ─── Formatting ───────────────────────────────────────────────────────────────

/** "R1 800 / project", or null when the project carries no price. */
function priceLabel(production: SmartProduction): string | null {
  if (production.price === null || production.price <= 0) return null;
  return `R${production.price.toLocaleString('en-ZA')} / ${production.price_unit}`;
}

/** "Photography · 2026" from whichever of the two exists. */
function metaLabel(production: SmartProduction): string {
  return [production.project_type, production.year].filter(Boolean).join(' · ');
}

// ─── Work Card ────────────────────────────────────────────────────────────────

function ProductionCard({
  production,
  index,
  revealed,
  onImageReady,
}: {
  production: SmartProduction;
  index: number;
  revealed: boolean;
  onImageReady: () => void;
}): React.ReactElement {
  const imageUrl = production.thumbnail_url || production.gallery?.[0]?.url || null;
  const price = priceLabel(production);
  const onLoad = useCallback(() => onImageReady(), [onImageReady]);

  // A project with no image used to be dropped from the page entirely, which
  // hid work rather than showing it plainly. Reveal it immediately instead,
  // since there is no image load to wait for.
  useEffect(() => {
    if (!imageUrl) onImageReady();
  }, [imageUrl, onImageReady]);

  return (
    <Link
      href={`/studio/${production.slug}`}
      className="group block relative aspect-[3/4] overflow-hidden bg-[#0A0A0B] border border-white/10 hover:border-[#D4A843]/40 transition-colors"
    >
      {!revealed && imageUrl && <ImageSkeleton />}

      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={production.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className={`object-cover transition-all duration-700 ease-out group-hover:scale-105 ${
            revealed ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={onLoad}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-800">
          <Camera className="w-10 h-10 text-neutral-700" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent z-10" />

      <div className="absolute bottom-0 left-0 right-0 p-5 z-20">
        <p className="text-[9px] font-mono text-[#D4A843] uppercase tracking-[0.2em] mb-2">
          {String(index + 1).padStart(2, '0')} {metaLabel(production) && `· ${metaLabel(production)}`}
        </p>
        <h3 className="text-lg md:text-xl font-display font-medium text-white uppercase leading-tight group-hover:text-[#D4A843] transition-colors">
          {production.title}
        </h3>
        {production.client && (
          <p className="text-[10px] font-mono text-neutral-400 mt-1">{production.client}</p>
        )}
        {price && (
          <p className="text-xs font-mono text-white/70 mt-3 pt-3 border-t border-white/15">
            {price}
          </p>
        )}
      </div>
    </Link>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  productions: SmartProduction[];
}

export default function SmartProductionClient({ productions }: Props) {
  const { onImageLoaded, isRevealed } = useSequentialReveal(productions.length);
  const count = productions.length;

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">

      {/* ── Header ── */}
      <div className="container mx-auto px-6 mb-16">
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

      {/* ── The work ── */}
      <section className="relative bg-[#050505] border-t border-white/5">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <div className="container mx-auto px-6 py-16 relative z-10">
          {count === 0 ? (
            <div className="border border-white/10 bg-[#0A0A0B] px-8 py-20 text-center">
              <Camera className="w-8 h-8 text-neutral-700 mx-auto mb-6" />
              <p className="text-neutral-400 font-light mb-2">
                No projects published yet.
              </p>
              <p className="text-sm text-neutral-500 font-light">
                Talk to us about your shoot and we will put a team together.
              </p>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 min-h-[44px] mt-8 border border-white/20 text-white px-8 py-4 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-colors"
              >
                Get in touch
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-4 mb-10">
                <h2 className="text-2xl md:text-3xl font-display font-medium text-white uppercase tracking-tight">
                  The Work
                </h2>
                <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-[0.2em]">
                  {count} project{count !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {productions.map((prod, index) => (
                  <ProductionCard
                    key={prod.id}
                    production={prod}
                    index={index}
                    revealed={isRevealed(index)}
                    onImageReady={() => onImageLoaded(index)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
