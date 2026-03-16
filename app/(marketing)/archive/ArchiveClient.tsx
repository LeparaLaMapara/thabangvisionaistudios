'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Clapperboard, Package } from 'lucide-react';

type ArchiveItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  category: 'production' | 'rental';
  meta: string;
  href: string;
  tags: string[];
  created_at: string;
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'production', label: 'Productions' },
  { key: 'rental', label: 'Rentals' },
] as const;

const CATEGORY_ICON = {
  production: Clapperboard,
  rental: Package,
} as const;

export default function ArchiveClient({ items }: { items: ArchiveItem[] }) {
  const [filter, setFilter] = useState<'all' | 'production' | 'rental'>('all');

  const filtered = filter === 'all' ? items : items.filter((i) => i.category === filter);

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] transition-colors duration-500">
      <section className="pt-40 pb-32">
        <div className="container mx-auto px-6">
          {/* Header */}
          <div className="mb-16">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs font-mono text-neutral-500 hover:text-black dark:hover:text-white transition-colors uppercase tracking-widest mb-8"
            >
              <ArrowLeft className="w-3 h-3" /> Back to Home
            </Link>
            <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">
              Archive
            </span>
            <h1 className="text-5xl md:text-7xl font-display font-medium text-black dark:text-white tracking-tighter uppercase">
              Past <span className="text-neutral-400 dark:text-neutral-500">Work</span>
            </h1>
            <p className="text-neutral-500 dark:text-neutral-400 font-light leading-relaxed mt-6 max-w-xl">
              Archived productions and equipment from our catalog. A record of everything we&apos;ve built and used.
            </p>
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-12 border-b border-black/10 dark:border-white/10 pb-4">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs font-mono uppercase tracking-widest pb-2 transition-all ${
                  filter === f.key
                    ? 'text-black dark:text-white border-b-2 border-black dark:border-white'
                    : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                }`}
              >
                {f.label}
                <span className="ml-2 text-neutral-400 dark:text-neutral-600">
                  {f.key === 'all' ? items.length : items.filter((i) => i.category === f.key).length}
                </span>
              </button>
            ))}
          </div>

          {/* Grid */}
          {filtered.length === 0 ? (
            <div className="text-center py-32">
              <p className="text-neutral-500 font-mono text-sm">No archived items yet.</p>
              <p className="text-neutral-400 dark:text-neutral-600 font-mono text-xs mt-2">
                Items marked as archived in the admin panel will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filtered.map((item, index) => {
                const Icon = CATEGORY_ICON[item.category];
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Link href={item.href} className="group block">
                      <div className="relative aspect-video overflow-hidden bg-neutral-200 dark:bg-neutral-900 border border-black/5 dark:border-white/10 mb-4">
                        <div className="absolute top-3 left-3 z-20">
                          <span className="flex items-center gap-1.5 text-[9px] font-mono bg-white/90 dark:bg-black/80 text-black dark:text-white border border-black/10 dark:border-white/20 px-2 py-1 uppercase tracking-wider backdrop-blur-md">
                            <Icon className="w-2.5 h-2.5" />
                            {item.category}
                          </span>
                        </div>
                        {item.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnail_url}
                            alt={item.title}
                            className="w-full h-full object-cover opacity-70 grayscale-0 md:grayscale group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Icon className="w-10 h-10 text-neutral-300 dark:text-neutral-700" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-lg font-display font-medium text-black dark:text-white uppercase truncate group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors">
                        {item.title}
                      </h3>
                      <p className="text-xs font-mono text-neutral-500 mt-1">{item.meta}</p>
                      {item.description && (
                        <p className="text-sm text-neutral-400 mt-2 line-clamp-2">{item.description}</p>
                      )}
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
