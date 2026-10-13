'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { gearCardImage, gearCardImageFallback } from '@/lib/rental/gear-image';
import type { RentalListItem } from '@/lib/supabase/queries/smartRentals';

export const ALL = 'all';

const LABELS: Record<string, string> = Object.fromEntries(RENTAL_CATEGORIES.map((c) => [c.value, c.label]));

export function categoryLabel(slug: string): string {
  return LABELS[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Filter chips: "All" first, then categories that have gear, biggest first. */
export function categoryChips(rentals: RentalListItem[]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rentals) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const cats = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, label: categoryLabel(value), count }));
  return [{ value: ALL, label: 'All', count: rentals.length }, ...cats];
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
            className="object-contain transition-transform duration-500 group-hover:scale-[1.03]"
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
            <span className="font-normal text-xs text-neutral-400"> / day</span>
          </>
        ) : (
          <span className="font-normal text-xs text-neutral-400">Ask for a price</span>
        )}
      </p>
    </Link>
  );
}

/**
 * /rentals: all the gear on one page, newest-ranked first, with a row of
 * category chips that filter in place. /rentals/<category> renders the same
 * page with that chip already chosen, so old links and Google still land
 * on the right gear.
 */
export default function AllGearClient({
  rentals,
  initialCategory = ALL,
  loadFailed = false,
}: {
  rentals: RentalListItem[];
  initialCategory?: string;
  loadFailed?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const chips = useMemo(() => categoryChips(rentals), [rentals]);
  const [active, setActive] = useState(
    chips.some((c) => c.value === initialCategory) ? initialCategory : ALL,
  );
  const shown = useMemo(
    () => (active === ALL ? rentals : rentals.filter((r) => r.category === active)),
    [rentals, active],
  );

  const choose = useCallback((value: string) => {
    setActive(value);
    // Keep the address shareable without a page load or a history entry per tap.
    window.history.replaceState(null, '', value === ALL ? '/rentals' : `/rentals/${value}`);
  }, []);

  const leadDays = Math.round(STUDIO.rental.minLeadTimeHours / 24);

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
        <div
          role="group"
          aria-label="Filter by category"
          className="container mx-auto flex gap-2 overflow-x-auto px-5 md:px-6 py-3 [scrollbar-width:none]"
        >
          {chips.map((c) => {
            const on = c.value === active;
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={on}
                onClick={() => choose(c.value)}
                className={`flex-none min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors ${
                  on
                    ? 'border-[#D4A843] bg-[#D4A843] text-[#050505]'
                    : 'border-white/15 bg-[#0d0d0d] text-neutral-200 hover:border-white/40'
                }`}
              >
                {c.label} <span className={on ? 'text-[#050505]/60' : 'text-neutral-500'}>{c.count}</span>
              </button>
            );
          })}
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

        {!loadFailed && shown.length === 0 ? (
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
