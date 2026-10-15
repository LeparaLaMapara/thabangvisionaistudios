'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import { ON_SITE_RENTAL, PLACEHOLDER_IMAGES, RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { gearCardImage, gearCardImageFallback } from '@/lib/rental/gear-image';
import type { RentalListItem } from '@/lib/supabase/queries/smartRentals';
import { isOnSiteCategory } from '@/lib/rental/on-site';
import { categoryLabel } from '@/lib/content/tags';

import { ALL, CATEGORIES } from '@/lib/rental/rentals-view';

export { ALL, CATEGORIES };

const TILE_IMAGES: Record<string, string> = Object.fromEntries(RENTAL_CATEGORIES.map((c) => [c.value, c.fallbackImage]));

export { categoryLabel };

/** Categories that have gear, biggest first, with their counts. */
export function categoryCounts(rentals: RentalListItem[]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rentals) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, label: categoryLabel(value), count }));
}

// ─── One category tile: brand photo, name, item count. ──────────────────────
function CategoryTile({
  value,
  label,
  count,
  onOpen,
}: {
  value: string;
  label: string;
  count: number;
  onOpen: (v: string) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onOpen(value)}
      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-neutral-900 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843]"
    >
      <Image
        src={TILE_IMAGES[value] ?? PLACEHOLDER_IMAGES.camerasOptics}
        alt=""
        fill
        sizes="(max-width: 768px) 50vw, 33vw"
        className="object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" aria-hidden="true" />
      <span className="absolute inset-x-0 bottom-0 p-3 md:p-5">
        <span className="block font-display text-sm md:text-xl font-semibold uppercase tracking-wide text-white">{label}</span>
        <span className="mt-0.5 block text-xs text-neutral-300">
          {count} item{count === 1 ? '' : 's'}
        </span>
      </span>
    </button>
  );
}

// ─── One item: photo, name, price. The whole card opens the item. ───────────
function GearCard({ rental }: { rental: RentalListItem }): React.ReactElement {
  const photo = rental.gallery?.[0]?.url ?? rental.thumbnail_url;
  // Cleaned photo first; the plain photo if background removal fails; text last.
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  // A non-Cloudinary photo has no cleaned version, so a failure skips straight to the text.
  const hasFallback = photo != null && gearCardImage(photo) !== gearCardImageFallback(photo);
  const onError = useCallback(
    () => setStage((s) => (s === 0 && hasFallback ? 1 : 2)),
    [hasFallback],
  );
  const src = photo ? (stage === 0 ? gearCardImage(photo) : gearCardImageFallback(photo)) : null;
  // A studio is a room, not a product: its photo fills the card.
  const place = isOnSiteCategory(rental.category);

  return (
    <Link
      href={`/rentals/${rental.category}/${rental.slug}`}
      className="group block min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843] focus-visible:ring-offset-4 focus-visible:ring-offset-[#050505]"
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#141414]">
        {src && stage < 2 ? (
          <Image
            key={src}
            src={src}
            alt={rental.title}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className={`${place ? 'object-cover' : 'object-contain'} transition-transform duration-500 group-hover:scale-[1.03]`}
            onError={onError}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">No photo yet</span>
        )}
        {!rental.is_available && (
          <span className="absolute left-2 top-2 rounded-full bg-neutral-800/90 px-2.5 py-1 text-[11px] font-medium text-neutral-200">
            Not available
          </span>
        )}
      </div>
      <h2 className="mt-2.5 line-clamp-2 text-sm leading-snug text-white group-hover:underline underline-offset-4">
        {rental.title}
      </h2>
      <p className="mt-1 text-[15px] font-semibold text-white">
        {rental.price_per_day != null ? (
          <>
            {formatRand(rental.price_per_day)}
            <span className="font-normal text-xs text-neutral-400">{place ? ` / ${ON_SITE_RENTAL.fullDayLabel.toLowerCase()}` : ' / day'}</span>
          </>
        ) : (
          <span className="font-normal text-xs text-neutral-400">Ask for a price</span>
        )}
      </p>
    </Link>
  );
}

/**
 * /rentals: two buttons, nothing more.
 *   All         every item at once (photo, name, price a day).
 *   Categories  the category tiles; a tile opens that category's gear.
 * /rentals/<category> opens straight on that category, so the home page,
 * old links and Google still land on the right gear.
 */
export default function AllGearClient({
  rentals,
  initialCategory = ALL,
  loadFailed = false,
  comingSoon = [],
}: {
  rentals: RentalListItem[];
  /** roles_v1: labels shown as coming-soon tiles (lib/rental/on-site.ts comingSoonLabels). */
  comingSoon?: readonly string[];
  /** 'all', 'categories', or a category slug. */
  initialCategory?: string;
  loadFailed?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const cats = useMemo(() => categoryCounts(rentals), [rentals]);
  // view: ALL, CATEGORIES (the tiles), or one category slug.
  const [view, setView] = useState(() =>
    initialCategory === CATEGORIES || cats.some((c) => c.value === initialCategory) ? initialCategory : ALL,
  );
  const inCategory = view !== ALL && view !== CATEGORIES;

  const shown = useMemo(
    () => (view === ALL ? rentals : inCategory ? rentals.filter((r) => r.category === view) : []),
    [rentals, view, inCategory],
  );

  const go = useCallback((next: string) => {
    setView(next);
    // Keep the address shareable without a page load or a history entry per tap.
    const path = next === ALL ? '/rentals' : next === CATEGORIES ? '/rentals?view=categories' : `/rentals/${next}`;
    window.history.replaceState(null, '', path);
  }, []);

  const leadDays = Math.round(STUDIO.rental.minLeadTimeHours / 24);

  const toggle = (value: string, label: string): React.ReactElement => {
    // "Categories" stays lit while browsing inside a category.
    const on = value === ALL ? view === ALL : view !== ALL;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={on}
        onClick={() => go(value)}
        className={`min-h-[44px] flex-1 rounded-full px-5 text-sm font-medium transition-colors sm:flex-none ${
          on ? 'bg-[#D4A843] text-[#050505]' : 'text-neutral-200 hover:text-white'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#050505] pt-24 pb-20">
      <div className="container mx-auto px-5 md:px-6 pt-4 md:pt-8">
        <h1 className="font-display text-3xl md:text-5xl font-semibold tracking-tight text-white">Rent gear</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          <span className="text-[#D4A843]">The price you see is the price you pay</span>
          {' · '}Collect in {STUDIO.fulfilment.dispatchFrom.name}
          {' · '}Book {leadDays} days ahead
        </p>
      </div>

      <div className="sticky top-20 z-30 mt-5 border-b border-white/5 bg-[#050505]/90 backdrop-blur">
        <div className="container mx-auto px-5 md:px-6 py-3">
          <div
            role="group"
            aria-label="Show"
            className="flex w-full gap-1 rounded-full border border-white/15 bg-[#0d0d0d] p-1 sm:inline-flex sm:w-auto"
          >
            {toggle(ALL, `All ${rentals.length}`)}
            {toggle(CATEGORIES, 'Categories')}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-5 md:px-6 pt-5">
        {loadFailed && (
          <div role="status" className="mb-6 flex flex-col gap-3 rounded-xl border border-[#D4A843]/30 bg-[#D4A843]/5 px-4 py-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-neutral-300">We couldn&apos;t load the gear just now.</p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-[#D4A843]/40 px-4 text-sm text-[#D4A843] hover:bg-[#D4A843]/10"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </button>
          </div>
        )}

        {inCategory && (
          <div className="mb-5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(CATEGORIES)}
              className="inline-flex min-h-[44px] items-center gap-1 pr-2 text-sm text-neutral-400 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Categories
            </button>
            <h2 className="text-lg font-semibold text-white">{categoryLabel(view)}</h2>
          </div>
        )}

        {view === CATEGORIES ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
            {cats.map((c) => (
              <CategoryTile key={c.value} {...c} onOpen={go} />
            ))}
            {comingSoon.map((label) => (
              <div key={label} className="flex min-h-[120px] flex-col justify-end border border-dashed border-white/15 p-4">
                <span className="text-sm text-white">{label}</span>
                <span className="text-xs font-mono uppercase tracking-widest text-neutral-500">Coming soon</span>
              </div>
            ))}
          </div>
        ) : !loadFailed && shown.length === 0 ? (
          <p className="py-24 text-center text-sm text-neutral-400">No equipment is listed for hire right now.</p>
        ) : (
          <div aria-live="polite" className="grid grid-cols-2 gap-x-3.5 gap-y-6 md:grid-cols-3 lg:grid-cols-4 md:gap-x-5 md:gap-y-8">
            {shown.map((r) => (
              <GearCard key={r.id} rental={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
