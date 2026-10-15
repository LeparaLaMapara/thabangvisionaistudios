'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PRODUCTION_CATEGORIES } from '@/lib/constants';
import { relatedRentalCategories } from '@/lib/seo/inventory';

interface RelatedCategoriesProps {
  currentSlug: string;
  type: 'studio' | 'rentals';
  locationSlug?: string;
  /**
   * Rentals: the category slugs that have published items. Only these are
   * linked: an empty category's page is a 404 (lib/seo/inventory rule).
   * Absent or empty, no rentals links are shown.
   */
  stocked?: readonly string[];
  className?: string;
}

export function RelatedCategories({ currentSlug, type, locationSlug, stocked = [], className = '' }: RelatedCategoriesProps) {
  const categories =
    type === 'studio'
      ? PRODUCTION_CATEGORIES.filter((c) => c.slug !== currentSlug).map((c) => ({
          slug: c.slug,
          label: c.name,
          description: c.description,
        }))
      : relatedRentalCategories(currentSlug, stocked);

  if (categories.length === 0) return null;

  const buildHref = (slug: string) => {
    const base = type === 'studio' ? `/studio/category/${slug}` : `/rentals/${slug}`;
    return locationSlug ? `${base}/in/${locationSlug}` : base;
  };

  return (
    <section className={`border-t border-white/5 py-12 ${className}`}>
      <div className="container mx-auto px-6">
        <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-6">
          {type === 'rentals' ? 'More to rent' : 'Other kinds of shoots'}
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
              <p className="text-xs text-neutral-400 font-light line-clamp-2">
                {cat.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
