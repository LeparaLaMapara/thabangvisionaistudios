'use client';

import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { SA_CITIES, COUNTRY_SLUG } from '@/lib/seo/cities';

interface AlsoAvailableInProps {
  basePath: string;
  currentCitySlug?: string;
  className?: string;
}

export function AlsoAvailableIn({ basePath, currentCitySlug, className = '' }: AlsoAvailableInProps) {
  const cities = SA_CITIES.filter((c) => c.slug !== currentCitySlug).slice(0, 8);

  return (
    <section className={`border-t border-white/5 py-12 ${className}`}>
      <div className="container mx-auto px-6">
        <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-500 mb-6 flex items-center gap-2">
          <MapPin className="w-3 h-3" />
          Also available in
        </h2>
        <div className="flex flex-wrap gap-2">
          {!currentCitySlug && (
            <Link
              href={`${basePath}/in/${COUNTRY_SLUG}`}
              className="px-4 py-2 text-[11px] font-mono uppercase tracking-wider border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 transition-colors"
            >
              All South Africa
            </Link>
          )}
          {cities.map((city) => (
            <Link
              key={city.slug}
              href={`${basePath}/in/${city.slug}`}
              className="px-4 py-2 text-[11px] font-mono uppercase tracking-wider border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 transition-colors"
            >
              {city.name}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
