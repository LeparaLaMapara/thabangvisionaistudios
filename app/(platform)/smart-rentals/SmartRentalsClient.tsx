'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowUpRight, PackagePlus } from 'lucide-react';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';

// ─── Category display metadata ────────────────────────────────────────────────
// Owned by this file — not imported from data.ts.
// Maps DB category slugs → display info.
// The fallback thumbnail comes from each category's first published rental.

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
    fallbackImage: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=2800&auto=format&fit=crop',
  },
  'lighting-power': {
    label:         'Lighting & Power',
    subtitle:      'Fixtures & Distribution',
    description:   'LED panels, HMIs, generators, power distribution, and battery solutions.',
    fallbackImage: 'https://images.unsplash.com/photo-1524253482453-3fed8d2fe12b?q=80&w=2800&auto=format&fit=crop',
  },
  'audio': {
    label:         'Audio',
    subtitle:      'Capture & Monitoring',
    description:   'Microphones, field recorders, mixers, wireless systems, and IEM monitoring.',
    fallbackImage: 'https://images.unsplash.com/photo-1590845947698-8924d7409b56?q=80&w=2800&auto=format&fit=crop',
  },
  'grip-motion': {
    label:         'Grip & Motion',
    subtitle:      'Support & Stabilization',
    description:   'Dollies, cranes, gimbals, sliders, and remote heads.',
    fallbackImage: 'https://images.unsplash.com/photo-1601506521793-dc748fc80b67?q=80&w=2800&auto=format&fit=crop',
  },
  'data-storage': {
    label:         'Data & Storage',
    subtitle:      'Media Management',
    description:   'RAID arrays, NVMe drives, on-set DITs, and cloud backup solutions.',
    fallbackImage: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2800&auto=format&fit=crop',
  },
  'crew-services': {
    label:         'Crew Services',
    subtitle:      'Technical Personnel',
    description:   'DPs, gaffers, sound operators, grips, and full-package crew for any scale.',
    fallbackImage: 'https://images.unsplash.com/photo-1605379399642-870262d3d051?q=80&w=2900&auto=format&fit=crop',
  },
  'specialized-solutions': {
    label:         'Specialized Solutions',
    subtitle:      'Emerging Tech & VP',
    description:   'LED volumes, virtual production tools, VR/AR rigs, and drone packages.',
    fallbackImage: 'https://images.unsplash.com/photo-1617581629397-a72507c3de9e?q=80&w=2800&auto=format&fit=crop',
  },
};

function getCategoryMeta(slug: string): CategoryMeta {
  return (
    CATEGORY_META[slug] ?? {
      label:         slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      subtitle:      'Equipment',
      description:   '',
      fallbackImage: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?q=80&w=2800&auto=format&fit=crop',
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

  // First thumbnail per category as the card hero image
  const categoryThumbnail = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of rentals) {
      if (r.category && !map[r.category] && r.thumbnail_url) {
        map[r.category] = r.thumbnail_url;
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
                Equipment catalogue coming soon.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-neutral-200 dark:bg-white/10 border border-neutral-200 dark:border-white/10">

              {/* Fixed CTA card */}
              <div className="relative group h-[450px] bg-black text-white dark:bg-white dark:text-black flex flex-col justify-center items-center text-center p-8 overflow-hidden">
                <PackagePlus className="w-16 h-16 mb-6 opacity-80" />
                <h3 className="text-3xl font-display font-medium uppercase mb-4">
                  Custom Package Builder
                </h3>
                <p className="text-sm font-mono opacity-70 mb-8 max-w-xs">
                  Use our AI assistant to recommend the perfect camera and lens combination for your
                  specific shot requirements.
                </p>
                <Link
                  href="/contact"
                  className="inline-block border border-white/30 dark:border-black/30 px-8 py-3 text-xs font-mono font-bold uppercase tracking-widest hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white transition-colors"
                >
                  Start Building
                </Link>
              </div>

              {/* Dynamic category cards — from DB */}
              {categories.map((cat, index) => {
                const meta  = getCategoryMeta(cat);
                const image = categoryThumbnail[cat] ?? meta.fallbackImage;

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
