'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { FilterBar, ProjectCard } from '@/components/projects/ProjectsComponents';
import { Video, Camera, Mic2, Clapperboard, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';
import type { Project } from '@/types/equipment';

// ─── Static data ──────────────────────────────────────────────────────────────

const SERVICES = [
  { title: 'Film & Video',       icon: Video,       desc: 'Narrative, Commercial, Music Video' },
  { title: 'Photography',        icon: Camera,      desc: 'Editorial, Portrait, Street' },
  { title: 'Live Events',        icon: Mic2,        desc: 'Broadcast, Concerts, Corporate' },
  { title: 'Behind The Scenes',  icon: Clapperboard, desc: 'Documentary, Process, Social' },
];

// ─── Adapter ──────────────────────────────────────────────────────────────────

function toProject(p: SmartProduction): Project {
  return {
    id:          p.id,
    slug:        p.slug,
    title:       p.title,
    client:      p.client      ?? undefined,
    year:        p.year != null ? String(p.year) : undefined,
    type:        p.project_type as 'film' | 'photography',
    subCategory: p.sub_category ?? '',
    thumbnail:   p.thumbnail_url ?? '',
    tags:        p.tags         ?? [],
    description: p.description  ?? undefined,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SmartProductionClient({
  productions,
}: {
  productions: SmartProduction[];
}) {
  const [activeType,      setActiveType]      = useState<'ALL' | 'FILM' | 'PHOTOGRAPHY'>('ALL');
  const [activeSubFilter, setActiveSubFilter] = useState<string | null>(null);

  const availableSubFilters = useMemo(() => {
    if (activeType === 'ALL') return [];
    const typeLower = activeType === 'FILM' ? 'film' : 'photography';
    const subCats = new Set(
      productions
        .filter(p => p.project_type === typeLower)
        .map(p => p.sub_category ?? '')
        .filter(Boolean),
    );
    return Array.from(subCats).sort();
  }, [activeType, productions]);

  const filteredProductions = productions.filter(p => {
    if (activeType !== 'ALL' && p.project_type !== (activeType === 'FILM' ? 'film' : 'photography')) return false;
    if (activeSubFilter && p.sub_category !== activeSubFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-20 transition-colors duration-500">

      {/* ── Hero ── */}
      <section className="relative min-h-[50vh] flex flex-col items-center justify-center border-b border-black/5 dark:border-white/5 bg-neutral-50 dark:bg-[#080808] py-20">
        <div className="container mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="order-2 lg:order-1">
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[10px] font-mono text-neutral-500 uppercase tracking-[0.3em] mb-4 block"
            >
              Creative Services Hub
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-7xl font-black text-black dark:text-white tracking-tighter uppercase mb-6 leading-none"
            >
              Blending AI <br />
              <span className="text-neutral-400 dark:text-neutral-500">with Storytelling</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-sm md:text-base text-neutral-600 dark:text-neutral-400 max-w-md font-light leading-relaxed mb-8"
            >
              We leverage data-driven insights and generative tools to enhance the creative process,
              delivering narrative depth with technical precision.
            </motion.p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-black text-white dark:bg-white dark:text-black px-6 py-3 hover:opacity-80 transition-opacity"
            >
              Start Production <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="order-1 lg:order-2 grid grid-cols-2 gap-4">
            {SERVICES.map((service, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + idx * 0.1 }}
                className="bg-white dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-6 flex flex-col items-center text-center hover:border-black/20 dark:hover:border-white/20 transition-colors"
              >
                <service.icon className="w-8 h-8 text-black dark:text-white mb-4 opacity-80" />
                <h3 className="text-sm font-bold uppercase tracking-widest mb-2">{service.title}</h3>
                <p className="text-[10px] font-mono text-neutral-500">{service.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Filter bar ── */}
      <FilterBar
        activeType={activeType}
        onTypeChange={setActiveType}
        activeSubFilter={activeSubFilter}
        onSubFilterChange={setActiveSubFilter}
        availableSubFilters={availableSubFilters}
      />

      {/* ── Grid ── */}
      <div className="container mx-auto px-6 pb-32">
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredProductions.map((p, index) => (
            <ProjectCard key={p.id} project={toProject(p)} index={index} />
          ))}
        </motion.div>

        {filteredProductions.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-neutral-500 font-mono text-xs uppercase tracking-widest">
              No projects found in this category.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
