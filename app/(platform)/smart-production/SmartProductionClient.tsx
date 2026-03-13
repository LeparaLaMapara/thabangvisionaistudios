'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FilterBar, ProjectCard } from '@/components/projects/ProjectsComponents';
import {
  Video, Camera, Mic2, Clapperboard, ChevronRight, Search, X,
  Film, Image, Users, Heart, ShoppingBag, Building2, Sparkles,
  Music, Briefcase, PartyPopper, BookOpen, Tv, Play,
  ArrowRight, Tag,
} from 'lucide-react';
import Link from 'next/link';
import type { SmartProduction } from '@/lib/supabase/queries/smartProductions';
import type { SmartRental } from '@/lib/supabase/queries/smartRentals';
import type { Project } from '@/types/equipment';
import { PRODUCTION_SERVICES } from '@/lib/constants';
import PackagePricing from '@/components/productions/PackagePricing';
import BriefForm from '@/components/productions/BriefForm';

// ─── Static data ──────────────────────────────────────────────────────────────

const SERVICES = [
  { title: 'Film & Video',       icon: Video,       desc: 'Narrative, Commercial, Music Video' },
  { title: 'Photography',        icon: Camera,      desc: 'Editorial, Portrait, Street' },
  { title: 'Live Events',        icon: Mic2,        desc: 'Broadcast, Concerts, Corporate' },
  { title: 'Behind The Scenes',  icon: Clapperboard, desc: 'Documentary, Process, Social' },
];

const PHOTOGRAPHY_CATEGORIES = [
  { title: 'Portraits & Headshots',    icon: Users,       fromConstants: true },
  { title: 'Commercial & Product',     icon: ShoppingBag, fromConstants: true },
  { title: 'Lifestyle & Editorial',    icon: Image,       fromConstants: true },
  { title: 'Weddings & Ceremonies',    icon: Heart,       fromConstants: false },
  { title: 'Fashion & Lookbook',       icon: Sparkles,    fromConstants: false },
  { title: 'Real Estate & Architecture', icon: Building2, fromConstants: false },
  { title: 'Content Creation',         icon: Camera,      fromConstants: false },
];

const FILM_CATEGORIES = [
  { title: 'Short-Form Video',         icon: Play,        fromConstants: true },
  { title: 'Music Video Production',   icon: Music,       fromConstants: true },
  { title: 'Corporate & Industrial Film', icon: Briefcase, fromConstants: true },
  { title: 'Wedding Cinematic',        icon: Heart,       fromConstants: false },
  { title: 'Documentary',              icon: BookOpen,     fromConstants: false },
  { title: 'Live Events',              icon: PartyPopper,  fromConstants: false },
  { title: 'Film Production',          icon: Film,        fromConstants: false },
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
  featuredRentals = [],
}: {
  productions: SmartProduction[];
  featuredRentals?: SmartRental[];
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

      {/* ── Hero ── */}
      <section className="relative min-h-[50vh] flex flex-col items-center justify-center border-b border-white/5 bg-[#080808] py-20">
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
              className="text-5xl md:text-7xl font-black text-white tracking-tighter uppercase mb-6 leading-none"
            >
              Blending AI <br />
              <span className="text-neutral-500">with Storytelling</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-sm md:text-base text-neutral-400 max-w-md font-light leading-relaxed mb-8"
            >
              We leverage data-driven insights and generative tools to enhance the creative process,
              delivering narrative depth with technical precision.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap gap-3"
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
              <Link
                href="/ubunye-ai-studio"
                className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest border border-white/20 text-white px-6 py-3 hover:border-[#D4A843] hover:text-[#D4A843] transition-colors"
              >
                Ask Ubunye <Sparkles className="w-3 h-3" />
              </Link>
            </motion.div>
          </div>

          <div className="order-1 lg:order-2 grid grid-cols-2 gap-4">
            {SERVICES.map((service, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + idx * 0.1 }}
                className="bg-[#0A0A0B] border border-white/5 p-6 flex flex-col items-center text-center hover:border-white/20 transition-colors"
              >
                <service.icon className="w-8 h-8 text-white mb-4 opacity-80" />
                <h3 className="text-sm font-bold uppercase tracking-widest mb-2 text-white">{service.title}</h3>
                <p className="text-[10px] font-mono text-neutral-500">{service.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Photography Division ── */}
      <section className="py-20 border-b border-white/5">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
              Photography Division
            </span>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
              <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase leading-none">
                Photography
              </h2>
              <span className="text-sm font-mono text-neutral-400">
                From <span className="text-[#D4A843] font-bold">{formatRate(photographyRate)}/hr</span>
              </span>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {PHOTOGRAPHY_CATEGORIES.map((cat, idx) => (
              <motion.div
                key={cat.title}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.05 }}
                className="group bg-[#0A0A0B] border border-white/5 p-5 flex flex-col items-center text-center hover:border-[#D4A843]/30 transition-colors"
              >
                <cat.icon className="w-7 h-7 text-[#D4A843] mb-3 opacity-70 group-hover:opacity-100 transition-opacity" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-white mb-1">{cat.title}</h3>
                {cat.fromConstants && (
                  <p className="text-[10px] font-mono text-neutral-500">{formatRate(photographyRate)}/hr</p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Film & Video Division ── */}
      <section className="py-20 border-b border-white/5">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
              Film & Video Division
            </span>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
              <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase leading-none">
                Film & Video
              </h2>
              <span className="text-sm font-mono text-neutral-400">
                From <span className="text-[#D4A843] font-bold">{formatRate(cinematographyRate)}/hr</span>
              </span>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {FILM_CATEGORIES.map((cat, idx) => (
              <motion.div
                key={cat.title}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.05 }}
                className="group bg-[#0A0A0B] border border-white/5 p-5 flex flex-col items-center text-center hover:border-[#D4A843]/30 transition-colors"
              >
                <cat.icon className="w-7 h-7 text-[#D4A843] mb-3 opacity-70 group-hover:opacity-100 transition-opacity" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-white mb-1">{cat.title}</h3>
                {cat.fromConstants && (
                  <p className="text-[10px] font-mono text-neutral-500">{formatRate(cinematographyRate)}/hr</p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Gear Cross-Sell: Shot On ThabangVision Gear ── */}
      {featuredRentals.length > 0 && (
        <section className="py-20 border-b border-white/5">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
                Equipment Catalog
              </span>
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
                <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase leading-none">
                  Shot On ThabangVision Gear
                </h2>
                <Link
                  href="/smart-rentals"
                  className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:text-white transition-colors"
                >
                  Browse All Gear <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </motion.div>

            <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              {featuredRentals.map((rental, idx) => (
                <motion.div
                  key={rental.id}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.08 }}
                  className="flex-shrink-0 w-[260px] bg-[#0A0A0B] border border-white/5 hover:border-[#D4A843]/30 transition-colors group"
                >
                  <Link href={`/smart-rentals/${rental.category}/${rental.slug}`} className="block">
                    {/* Preview — first gallery image */}
                    <div className="relative aspect-[4/3] bg-[#111] overflow-hidden">
                      {rental.gallery && rental.gallery.length > 0 ? (
                        <img
                          src={rental.gallery[0].url}
                          alt={rental.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Tv className="w-10 h-10 text-neutral-700" />
                        </div>
                      )}
                      {/* Badge */}
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-[#D4A843] text-black text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-1">
                        <Tag className="w-2.5 h-2.5" />
                        Also Available for Rent
                      </span>
                    </div>

                    {/* Info */}
                    <div className="p-4">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-1 truncate">
                        {rental.title}
                      </h3>
                      {(rental.brand || rental.model) && (
                        <p className="text-[10px] font-mono text-neutral-500 mb-2 truncate">
                          {[rental.brand, rental.model].filter(Boolean).join(' ')}
                        </p>
                      )}
                      {rental.price_per_day != null && (
                        <p className="text-xs font-mono text-[#D4A843] font-bold">
                          R{rental.price_per_day.toLocaleString('en-ZA')}/day
                        </p>
                      )}
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/smart-rentals"
                className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest border border-white/10 text-white px-6 py-3 hover:border-[#D4A843] hover:text-[#D4A843] transition-colors"
              >
                Browse All Gear <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Package Pricing ── */}
      <PackagePricing />

      {/* ── Filter bar ── */}
      <div id="portfolio">
        <FilterBar
          activeType={activeType}
          onTypeChange={setActiveType}
          activeSubFilter={activeSubFilter}
          onSubFilterChange={setActiveSubFilter}
          availableSubFilters={availableSubFilters}
        />
      </div>

      {/* ── Search bar ── */}
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

      {/* ── Brief Form ── */}
      <div id="brief-form">
        <BriefForm />
      </div>

    </div>
  );
}
