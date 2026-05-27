'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PRODUCTION_CATEGORIES, RENTAL_CATEGORIES } from '@/lib/constants';

interface RelatedCategoriesProps {
  currentSlug: string;
  type: 'studio' | 'rentals';
  locationSlug?: string;
  className?: string;
}

export function RelatedCategories({ currentSlug, type, locationSlug, className = '' }: RelatedCategoriesProps) {
  const categories =
    type === 'studio'
      ? PRODUCTION_CATEGORIES.filter((c) => c.slug !== currentSlug).map((c) => ({
          slug: c.slug,
          label: c.name,
          description: c.description,
        }))
      : RENTAL_CATEGORIES.filter((c) => c.value !== currentSlug).map((c) => ({
          slug: c.value,
          label: c.label,
          description: c.description,
        }));

  const buildHref = (slug: string) => {
    const base = type === 'studio' ? `/studio/category/${slug}` : `/rentals/${slug}`;
    return locationSlug ? `${base}/in/${locationSlug}` : base;
  };

  return (
    <section className={`border-t border-white/5 py-12 ${className}`}>
      <div className="container mx-auto px-6">
        <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-500 mb-6">
          Related Services
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.slice(0, 6).map((cat) => (
            <Link
              key={cat.slug}
              href={buildHref(cat.slug)}
              className="group p-5 border border-white/5 hover:border-white/20 transition-colors"
            >
              <h3 className="text-sm font-display font-medium uppercase text-white group-hover:text-[#D4A843] transition-colors mb-1 flex items-center gap-2">
                {cat.label}
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </h3>
              <p className="text-[11px] text-neutral-500 font-light line-clamp-2">
                {cat.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
