'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';
import { PLACEHOLDER_IMAGES } from '@/lib/constants';

// ─── Category display metadata ────────────────────────────────────────────────
// Maps DB category slugs → display info.
// Category images are fixed brand images from PLACEHOLDER_IMAGES — never overridden by rental thumbnails.

type CategoryMeta = {
  label: string;
  subtitle: string;
  description: string;
  fallbackImage: string;
};

const CATEGORY_META: Record<string, CategoryMeta> = {
  'cameras-optics': {
    label:         'Cameras & Optics',
    subtitle:      'High-end Cinema Systems',
    description:   'Cinema cameras, prime and zoom lens sets, and anamorphics for every format.',
    fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
  },
  'lighting-power': {
    label:         'Lighting & Power',
    subtitle:      'Fixtures & Distribution',
    description:   'LED panels, HMIs, generators, power distribution, and battery solutions.',
    fallbackImage: PLACEHOLDER_IMAGES.lightingPower,
  },
  'audio': {
    label:         'Audio',
    subtitle:      'Capture & Monitoring',
    description:   'Microphones, field recorders, mixers, wireless systems, and IEM monitoring.',
    fallbackImage: PLACEHOLDER_IMAGES.audio,
  },
  'grip-motion': {
    label:         'Grip & Motion',
    subtitle:      'Support & Stabilization',
    description:   'Dollies, cranes, gimbals, sliders, and remote heads.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
  'data-storage': {
    label:         'Data & Storage',
    subtitle:      'Media Management',
    description:   'RAID arrays, NVMe drives, on-set DITs, and cloud backup solutions.',
    fallbackImage: PLACEHOLDER_IMAGES.dataStorage,
  },
  'crew-services': {
    label:         'Crew Services',
    subtitle:      'Technical Personnel',
    description:   'DPs, gaffers, sound operators, grips, and full-package crew for any scale.',
    fallbackImage: PLACEHOLDER_IMAGES.crewServices,
  },
  'specialized-solutions': {
    label:         'Specialized Solutions',
    subtitle:      'Emerging Tech & VP',
    description:   'LED volumes, virtual production tools, VR/AR rigs, and drone packages.',
    fallbackImage: PLACEHOLDER_IMAGES.specializedSolutions,
  },
  'aerial-support': {
    label:         'Aerial Support',
    subtitle:      'Drone & Aerial Systems',
    description:   'Professional drone rigs, aerial camera systems, and licensed pilot services.',
    fallbackImage: PLACEHOLDER_IMAGES.gripMotion,
  },
};

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
  // Derive unique categories from live DB data — order preserved by first occurrence
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

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">

      {/* ── Header ── */}
      <div className="container mx-auto px-6 mb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="border-l border-black/20 dark:border-white/20 pl-8 md:pl-16 py-4">
            <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">
              02 // Equipment Fleet
            </span>
            <h1 className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tight leading-[0.9] mb-8 uppercase">
              AI-Optimized Gear <br />
              <span className="text-neutral-400 dark:text-neutral-500">For Seamless Productions</span>
            </h1>
            <p className="max-w-2xl text-lg text-neutral-600 dark:text-neutral-300 font-light leading-relaxed">
              Our inventory isn&apos;t just maintained; it&apos;s analyzed. Using predictive data, we ensure
              every camera, lens, and light is calibrated for peak performance before it leaves the depot.
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── Category Grid ── */}
      <section className="relative bg-neutral-50 dark:bg-[#050505] border-t border-black/5 dark:border-white/5">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <div className="container mx-auto px-6 py-12 relative z-10">

          {categories.length === 0 ? (
            /* Empty state — no published rentals yet */
            <div className="py-32 text-center">
              <p className="text-neutral-500 dark:text-neutral-600 font-mono text-sm uppercase tracking-widest">
                Professional Equipment for Every Production
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10">

              {/* Dynamic category cards — from DB */}
              {categories.map((cat, index) => {
                const meta  = getCategoryMeta(cat);
                const image = meta.fallbackImage;

                return (
                  <motion.div
                    key={cat}
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.08 }}
                    className="relative group h-[450px] overflow-hidden bg-white dark:bg-[#0A0A0B] cursor-pointer"
                  >
                    <Link href={`/smart-rentals/${cat}`} className="block w-full h-full relative">
                      <div className="absolute inset-0 z-10 bg-black/40 dark:bg-black/60 group-hover:bg-black/20 dark:group-hover:bg-black/30 transition-colors duration-500" />

                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image}
                        alt={meta.label}
                        className="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700 ease-out"
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
                            {categoryCount[cat] != null && (
                              <span className="ml-2 text-white/40">
                                — {categoryCount[cat]} item{categoryCount[cat] !== 1 ? 's' : ''}
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
                );
              })}

            </div>
          )}
        </div>
      </section>

    </div>
  );
}
