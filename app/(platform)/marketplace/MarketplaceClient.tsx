'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  Search,
  ShoppingBag,
  Wrench,
  SlidersHorizontal,
  MapPin,
  ChevronRight,
  Tag,
  Command,
} from 'lucide-react';
import type { Listing, ListingType } from '@/types/marketplace';
import { STUDIO } from '@/lib/constants';
import { formatRand, formatRate } from '@/lib/format/money';

// ─── Filter types ────────────────────────────────────────────────────────────

type TypeFilter = 'all' | ListingType;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(price: number, _currency: string, pricingModel: string) {
  const unit: Record<string, string> = { hourly: 'hour', daily: 'day', weekly: 'week' };
  return unit[pricingModel] ? formatRate(price, unit[pricingModel]) : formatRand(price);
}

function conditionLabel(condition: string | null) {
  if (!condition) return null;
  const labels: Record<string, string> = {
    new: 'New',
    'like-new': 'Like New',
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
  };
  return labels[condition] ?? condition;
}

// ─── Listing Card ────────────────────────────────────────────────────────────

function ListingCard({ listing, index }: { listing: Listing; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      layout
    >
      <Link
        href={`/marketplace/${listing.slug}`}
        className="group block bg-white dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 overflow-hidden hover:border-black/20 dark:hover:border-white/20 transition-all duration-300"
      >
        {/* Thumbnail */}
        <div className="relative aspect-[4/3] bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
          {listing.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.thumbnail_url}
              alt={listing.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {listing.type === 'gear' ? (
                <ShoppingBag className="w-10 h-10 text-neutral-300 dark:text-neutral-400" />
              ) : (
                <Wrench className="w-10 h-10 text-neutral-300 dark:text-neutral-400" />
              )}
            </div>
          )}

          {/* Type badge */}
          <span className="absolute top-3 left-3 px-2 py-1 text-xs font-mono font-bold uppercase tracking-widest bg-black/80 text-white dark:bg-white/80 dark:text-black">
            {listing.type}
          </span>

          {/* Condition badge */}
          {listing.condition && (
            <span className="absolute top-3 right-3 px-2 py-1 text-xs font-mono uppercase tracking-widest bg-white/90 text-black dark:bg-black/90 dark:text-white border border-black/10 dark:border-white/10">
              {conditionLabel(listing.condition)}
            </span>
          )}
        </div>

        {/* Details */}
        <div className="p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-black dark:text-white mb-2 truncate group-hover:underline">
            {listing.title}
          </h3>

          <div className="flex items-center justify-between mb-3">
            <span className="text-lg font-display font-bold text-black dark:text-white">
              {formatPrice(listing.price, listing.currency, listing.pricing_model)}
            </span>
            {listing.category && (
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                {listing.category.replace(/-/g, ' ')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
            {listing.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {listing.location}
              </span>
            )}
          </div>

          {/* Tags */}
          {listing.tags && listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {listing.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs font-mono uppercase tracking-widest border border-black/10 dark:border-white/10 text-neutral-400"
                >
                  {tag}
                </span>
              ))}
              {listing.tags.length > 3 && (
                <span className="px-2 py-0.5 text-xs font-mono text-neutral-400">
                  +{listing.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function MarketplaceClient({
  listings,
}: {
  listings: Listing[];
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);


  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set(
      listings
        .map((l) => l.category)
        .filter((c): c is string => Boolean(c)),
    );
    return Array.from(cats).sort();
  }, [listings]);

  // Filter listings
  const filtered = useMemo(() => {
    return listings.filter((l) => {
      if (typeFilter !== 'all' && l.type !== typeFilter) return false;
      if (categoryFilter && l.category !== categoryFilter) return false;
      return true;
    });
  }, [listings, typeFilter, categoryFilter]);

  const counts = useMemo(
    () => ({
      all: listings.length,
      gear: listings.filter((l) => l.type === 'gear').length,
      service: listings.filter((l) => l.type === 'service').length,
    }),
    [listings],
  );

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-20 transition-colors duration-500">
      {/* ── Hero ── */}
      <section className="relative min-h-[50vh] flex flex-col items-center justify-center border-b border-black/5 dark:border-white/5 bg-neutral-50 dark:bg-[#080808] py-20">
        <div className="container mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="order-2 lg:order-1">
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs font-mono text-neutral-400 uppercase tracking-[0.3em] mb-4 block"
            >
              Supplied by ID-checked creators
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-7xl font-black text-black dark:text-white tracking-tighter uppercase mb-6 leading-none"
            >
              Creator{' '}
              <br />
              <span className="text-neutral-400 dark:text-neutral-400">
                Catalogue
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-sm md:text-base text-neutral-400 dark:text-neutral-400 max-w-md font-light leading-relaxed mb-8"
            >
              Creative gear and services from ID-checked creators, supplied to
              you by {STUDIO.shortName}. Enquire about an item and we confirm
              availability and the price with you; you pay {STUDIO.shortName} directly.
            </motion.p>
            <Link
              href="/dashboard/listings"
              className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest bg-black text-white dark:bg-white dark:text-black px-6 py-3 hover:opacity-80 transition-opacity"
            >
              Supply Your Gear <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="order-1 lg:order-2 grid grid-cols-2 gap-4">
            {[
              {
                icon: ShoppingBag,
                title: 'Gear',
                desc: 'Cameras, Lenses, Lighting, Audio',
                count: counts.gear,
              },
              {
                icon: Wrench,
                title: 'Services',
                desc: 'Editing, Color, Sound, VFX',
                count: counts.service,
              },
              {
                icon: Tag,
                title: 'Fair Pricing',
                desc: 'You Set Your Rates',
                count: null,
              },
              {
                icon: SlidersHorizontal,
                title: 'Verified',
                desc: 'Everyone passes an ID check',
                count: null,
              },
            ].map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + idx * 0.1 }}
                className="bg-white dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-6 flex flex-col items-center text-center hover:border-black/20 dark:hover:border-white/20 transition-colors"
              >
                <item.icon className="w-8 h-8 text-black dark:text-white mb-4 opacity-80" />
                <h3 className="text-sm font-bold uppercase tracking-widest mb-2">
                  {item.title}
                </h3>
                <p className="text-xs font-mono text-neutral-400">
                  {item.count !== null ? `${item.count} ${item.count === 1 ? 'listing' : 'listings'}` : item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Filters ── */}
      <div className="sticky top-20 z-30 bg-white/90 dark:bg-[#050505]/90 backdrop-blur-md border-b border-black/5 dark:border-white/5">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            {/* Type tabs */}
            <div className="flex gap-1">
              {(
                [
                  { key: 'all', label: 'All', count: counts.all },
                  { key: 'gear', label: 'Gear', count: counts.gear },
                  { key: 'service', label: 'Services', count: counts.service },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setTypeFilter(tab.key);
                    setCategoryFilter(null);
                  }}
                  className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest transition-colors ${
                    typeFilter === tab.key
                      ? 'bg-black text-white dark:bg-white dark:text-black'
                      : 'text-neutral-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  {tab.label}{' '}
                  <span className="opacity-50">({tab.count})</span>
                </button>
              ))}
            </div>

            {/* Category filter */}
            {categories.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={`min-h-[44px] px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors ${
                    !categoryFilter
                      ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white'
                      : 'text-neutral-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  All Categories
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`min-h-[44px] px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors ${
                      categoryFilter === cat
                        ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white'
                        : 'text-neutral-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    {cat.replace(/-/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Search hint (opens global search) ── */}
      <div className="container mx-auto px-6 mt-8 mb-8">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('toggle-search'))}
          className="flex items-center gap-2 max-w-md w-full px-3 py-2.5 bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-neutral-400 dark:text-neutral-400 text-sm font-mono hover:border-black/20 dark:hover:border-white/20 transition-colors"
        >
          <Search className="w-4 h-4" />
          <span className="flex-1 text-left">Search gear, services, creators...</span>
          <kbd className="hidden sm:flex items-center gap-0.5 text-xs font-mono border border-black/10 dark:border-white/10 px-1.5 py-0.5">
            <Command className="w-2.5 h-2.5" />K
          </kbd>
        </button>
      </div>

      {/* ── Grid ── */}
      <div className="container mx-auto px-6 pb-32">
        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
        >
          {filtered.map((listing, index) => (
            <ListingCard key={listing.id} listing={listing} index={index} />
          ))}
        </motion.div>

        {filtered.length === 0 && (
          <div className="py-20 text-center">
            <ShoppingBag className="w-12 h-12 text-neutral-300 dark:text-neutral-400 mx-auto mb-4" />
            <p className="text-neutral-400 font-mono text-xs uppercase tracking-widest mb-2">
              No listings found.
            </p>
            <p className="text-neutral-400 font-mono text-xs">
              Be the first to supply gear or services.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
