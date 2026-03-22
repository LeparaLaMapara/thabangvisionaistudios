'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FilterBar, ProjectCard } from '@/components/projects/ProjectsComponents';
import {
  Video, Camera, Mic2, Search, X,
  Film, Image, Users, Heart, ShoppingBag, Building2, Sparkles,
  Music, Briefcase, PartyPopper, BookOpen, Play,
  ChevronRight, ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';
import type { Project } from '@/types/equipment';
import { PRODUCTION_SERVICES } from '@/lib/constants';
import PackagePricing from '@/components/productions/PackagePricing';
import BriefForm from '@/components/productions/BriefForm';

// ─── Static data ──────────────────────────────────────────────────────────────

const WHAT_WE_SHOOT = [
  { title: 'Weddings',          icon: Heart,       desc: 'Photography & cinematic film' },
  { title: 'Music Videos',      icon: Music,       desc: 'Multi-setup shoots, SFX, cinema glass' },
  { title: 'Corporate',         icon: Briefcase,   desc: 'Brand films, training, interviews' },
  { title: 'Portraits',         icon: Users,       desc: 'Headshots, editorial, lifestyle' },
  { title: 'Events',            icon: PartyPopper, desc: 'Conferences, launches, concerts' },
  { title: 'Content Creation',  icon: Camera,      desc: 'Social media, product, lookbook' },
  { title: 'Documentaries',     icon: BookOpen,    desc: 'Long-form storytelling' },
  { title: 'Short-Form Video',  icon: Play,        desc: 'Reels, TikTok, YouTube Shorts' },
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRate(rate: number): string {
  return `R${rate.toLocaleString('en-ZA')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SmartProductionClient({
  productions,
}: {
  productions: SmartProduction[];
}) {
  const [activeType,      setActiveType]      = useState<'ALL' | 'FILM' | 'PHOTOGRAPHY'>('ALL');
  const [activeSubFilter, setActiveSubFilter] = useState<string | null>(null);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  }, []);

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

  const filteredProductions = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return productions.filter(p => {
      if (activeType !== 'ALL' && p.project_type !== (activeType === 'FILM' ? 'film' : 'photography')) return false;
      if (activeSubFilter && p.sub_category !== activeSubFilter) return false;
      if (q) {
        const matchTitle = p.title.toLowerCase().includes(q);
        const matchClient = (p.client ?? '').toLowerCase().includes(q);
        const matchDesc = (p.description ?? '').toLowerCase().includes(q);
        const matchTags = (p.tags ?? []).some(tag => tag.toLowerCase().includes(q));
        if (!matchTitle && !matchClient && !matchDesc && !matchTags) return false;
      }
      return true;
    });
  }, [productions, activeType, activeSubFilter, debouncedSearch]);

  const photographyRate = PRODUCTION_SERVICES.photography.portrait.rate;
  const cinematographyRate = PRODUCTION_SERVICES.cinematography.shortForm.rate;

  return (
    <div className="min-h-screen bg-[#050505] pt-20 transition-colors duration-500">

      {/* ── 1. Hero — Clear value prop ── */}
      <section className="relative min-h-[50vh] flex items-center border-b border-white/5 bg-[#080808] py-20">
        <div className="container mx-auto px-6 max-w-4xl text-center">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block"
          >
            Photography &amp; Film Production
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl sm:text-5xl md:text-7xl font-black text-white tracking-tighter uppercase mb-6 leading-none"
          >
            We Shoot Weddings, <br />
            <span className="text-neutral-500">Music Videos, Corporate Films &amp; Content</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-sm md:text-base text-neutral-400 max-w-2xl mx-auto font-light leading-relaxed mb-8"
          >
            Professional photography and film production across South Africa.
            Transparent hourly rates. No hidden fees. From {formatRate(photographyRate)}/hr.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap justify-center gap-3"
          >
            <a
              href="#brief-form"
              className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black px-6 py-3 hover:opacity-80 transition-opacity"
            >
              Get a Quote <ChevronRight className="w-3 h-3" />
            </a>
            <a
              href="#portfolio"
              className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-white text-black px-6 py-3 hover:opacity-80 transition-opacity"
            >
              View Our Work <ChevronRight className="w-3 h-3" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* ── 2. Our Work (portfolio) — social proof first ── */}
      <div id="portfolio">
        <FilterBar
          activeType={activeType}
          onTypeChange={setActiveType}
          activeSubFilter={activeSubFilter}
          onSubFilterChange={setActiveSubFilter}
          availableSubFilters={availableSubFilters}
        />
      </div>

      {/* Search bar */}
      <div className="container mx-auto px-6 mb-8">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by title, client, description, or tags..."
            className="w-full bg-neutral-900 border border-white/10 text-white pl-10 pr-9 py-2.5 text-sm font-mono placeholder:text-neutral-600 focus:outline-none focus:border-white transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Portfolio grid */}
      <div className="container mx-auto px-6 pb-20">
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredProductions.map((p, index) => (
            <ProjectCard key={p.id} project={toProject(p)} index={index} />
          ))}
        </motion.div>

        {filteredProductions.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-neutral-500 font-mono text-xs uppercase tracking-widest">
              {debouncedSearch
                ? 'No projects match your search.'
                : 'No projects found in this category.'}
            </p>
            {debouncedSearch && (
              <button
                onClick={() => handleSearchChange('')}
                className="mt-4 text-xs font-bold underline text-neutral-500 hover:text-white transition-colors"
              >
                Clear Search
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── 3. What We Shoot — combined categories ── */}
      <section className="py-20 border-t border-white/5">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
              Services
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase leading-none mb-4">
              What We Shoot
            </h2>
            <p className="text-neutral-400 max-w-lg mx-auto text-sm">
              Photography from {formatRate(photographyRate)}/hr. Film &amp; video from {formatRate(cinematographyRate)}/hr. All rates transparent — no hidden fees.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {WHAT_WE_SHOOT.map((cat, idx) => (
              <motion.div
                key={cat.title}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.05 }}
                className="group bg-[#0A0A0B] border border-white/5 p-6 flex flex-col items-center text-center hover:border-[#D4A843]/30 transition-colors"
              >
                <cat.icon className="w-7 h-7 text-[#D4A843] mb-3 opacity-70 group-hover:opacity-100 transition-opacity" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-white mb-1">{cat.title}</h3>
                <p className="text-[10px] font-mono text-neutral-500">{cat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. Package Pricing ── */}
      <PackagePricing />

      {/* ── 5. Brief Form ── */}
      <div id="brief-form">
        <BriefForm />
      </div>

    </div>
  );
}
