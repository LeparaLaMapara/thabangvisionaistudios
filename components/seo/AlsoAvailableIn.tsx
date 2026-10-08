'use client';

import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { LISTED_CITIES, type SACity } from '@/lib/seo/cities';

interface AlsoAvailableInProps {
  basePath: string;
  currentCitySlug?: string;
  className?: string;
  /** The cities to link to. Defaults to the listed Gauteng cities; other
   *  cities have no pages (they redirect to the category page). */
  cities?: SACity[];
}

export function AlsoAvailableIn({ basePath, currentCitySlug, className = '', cities: pool = LISTED_CITIES }: AlsoAvailableInProps) {
  const cities = pool.filter((c) => c.slug !== currentCitySlug).slice(0, 8);
  if (cities.length === 0) return null;

  return (
    <section className={`border-t border-white/5 py-12 ${className}`}>
      <div className="container mx-auto px-6">
        <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-6 flex items-center gap-2">
          <MapPin className="w-3 h-3" />
          Also available in
        </h2>
        <div className="flex flex-wrap gap-2">
          {cities.map((city) => (
            <Link
              key={city.slug}
              href={`${basePath}/in/${city.slug}`}
              className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 transition-colors"
            >
              {city.name}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
