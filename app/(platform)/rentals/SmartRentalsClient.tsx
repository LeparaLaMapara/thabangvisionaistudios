'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import { PLACEHOLDER_IMAGES, RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { collectionPoint } from '@/lib/rental/collection-point';

// ─── Category card ────────────────────────────────────────────────────────────
// Cards used to stay at opacity 0 until their image -- and every image before
// it -- fired onLoad. One broken image left the rest of the grid invisible
// (but still focusable), so cards now render straight away over a dark
// placeholder and the image fills in when it arrives.
function CategoryCard({
  cat,
  meta,
  index,
  count,
}: {
  cat: string;
  meta: CategoryMeta;
  index: number;
  count: number | undefined;
}): React.ReactElement {
  return (
    <div className="relative h-[450px] overflow-hidden bg-[#0A0A0B]">
      <Link
        href={`/rentals/${cat}`}
        className="group block w-full h-full relative"
      >
        <div className="absolute inset-0 bg-neutral-900" aria-hidden="true" />
        <Image
          src={meta.fallbackImage}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover grayscale-0 md:grayscale md:group-hover:grayscale-0 md:group-focus-visible:grayscale-0 scale-100 group-hover:scale-105 transition-all duration-700 ease-out"
        />
        <div className="absolute inset-0 z-10 bg-black/30 md:bg-black/60 group-hover:bg-black/30 group-focus-visible:bg-black/30 transition-colors duration-500" />

        <div className="absolute inset-0 z-20 flex flex-col justify-between p-8">
          <div className="flex justify-between items-start">
            <span className="text-xs font-mono text-white/80 group-hover:text-white transition-colors" aria-hidden="true">
              0{index + 1}
            </span>
            <ArrowUpRight aria-hidden="true" className="text-white opacity-0 -translate-y-2 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 w-5 h-5" />
          </div>
          <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
            <h2 className="text-2xl font-display font-medium tracking-wide text-white uppercase mb-2">
              {meta.label}
            </h2>
            <p className="text-xs font-mono text-white/80 uppercase tracking-widest mb-4">
              {meta.subtitle}
              {count != null && (
                <span className="ml-2 text-white/70">
                  | {count} item{count !== 1 ? 's' : ''}
                </span>
              )}
            </p>
            <p className="text-sm text-neutral-300 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-500 delay-100 leading-relaxed border-t border-white/20 pt-4">
              {meta.description}
            </p>
          </div>
        </div>
      </Link>
    </div>
  );
}

// ─── Category display metadata ────────────────────────────────────────────────
// Maps DB category slugs to display info.
// Category images are fixed brand images from PLACEHOLDER_IMAGES. Never overridden by rental thumbnails.

type CategoryMeta = {
  label: string;
  subtitle: string;
  description: string;
  fallbackImage: string;
};

const CATEGORY_META: Record<string, CategoryMeta> = Object.fromEntries(
  RENTAL_CATEGORIES.map(c => [c.value, { label: c.label, subtitle: c.subtitle, description: c.description, fallbackImage: c.fallbackImage }]),
);

function getCategoryMeta(slug: string): CategoryMeta {
  return (
    CATEGORY_META[slug] ?? {
      label:         slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      subtitle:      'Equipment',
      description:   '',
      fallbackImage: PLACEHOLDER_IMAGES.camerasOptics,
    }
  );
}

const HIDDEN_CATEGORIES = new Set(['crew-services']);

// ─── Component ────────────────────────────────────────────────────────────────

export default function SmartRentalsClient({
  categories: counted,
  loadFailed = false,
}: {
  /** Live categories with item counts, best-ranked first. */
  categories: { category: string; count: number }[];
  /** True when the stock could not be read; the page then falls back to the fixed category list. */
  loadFailed?: boolean;
}) {
  const router = useRouter();

  // Live categories when we have them. If the stock read failed, still offer
  // the fixed category list (without counts) so the page is never a dead end.
  const categories = useMemo(() => {
    if (loadFailed) {
      return RENTAL_CATEGORIES
        .filter(c => !HIDDEN_CATEGORIES.has(c.value))
        .map(c => ({ category: c.value as string, count: undefined as number | undefined }));
    }
    return counted
      .filter(c => !HIDDEN_CATEGORIES.has(c.category))
      .map(c => ({ category: c.category, count: c.count as number | undefined }));
  }, [counted, loadFailed]);

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">

      {/* ── Header ── */}
      <div className="container mx-auto px-6 mb-24">
        {/* No fade-in on the heading: it is the page's largest paint (LCP),
            and an 0.8s opacity animation pushed that back. */}
        <div>
          <div className="border-l border-white/20 pl-4 md:pl-16 py-4 min-w-0">
            <h1 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tight leading-[0.9] mb-8 uppercase break-words hyphens-auto">
              Professional Gear <br />
              <span className="text-neutral-400">For Every Shoot</span>
            </h1>
            <p className="max-w-2xl text-lg text-neutral-300 font-light leading-relaxed">
              Free to join. You only pay when you book, and the price on each item is the price you pay.
              All gear is ours and is checked before every hire. Book at least {Math.round(STUDIO.rental.minLeadTimeHours / 24)} days ahead. Collect at {collectionPoint()}. After your first hire we can also deliver within {STUDIO.fulfilment.delivery.maxRadiusKm} km.
            </p>
          </div>
        </div>
      </div>

      {/* ── Category Grid ── */}
      <section aria-label="Equipment categories" className="relative bg-[#050505] border-t border-white/5">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <div className="container mx-auto px-6 py-12 relative z-10">

          {loadFailed && (
            <div role="status" className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3 border border-[#D4A843]/30 bg-[#D4A843]/5 px-4 py-3">
              <p className="text-sm text-neutral-300 flex-1">
                We couldn&apos;t load live stock just now, so item counts are missing. You can still browse every category.
              </p>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 border border-[#D4A843]/40 text-[#D4A843] text-xs font-mono font-bold uppercase tracking-widest hover:bg-[#D4A843]/10 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Try again
              </button>
            </div>
          )}

          {categories.length === 0 ? (
            /* Empty state. No published rentals yet. */
            <div className="py-32 text-center">
              <p className="text-neutral-400 font-mono text-sm uppercase tracking-widest">
                No equipment is listed for hire right now.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/10 border border-white/10">
              {categories.map(({ category, count }, index) => (
                <CategoryCard
                  key={category}
                  cat={category}
                  meta={getCategoryMeta(category)}
                  index={index}
                  count={count}
                />
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
