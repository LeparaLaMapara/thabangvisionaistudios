import type { CarouselItem } from '@/components/cinematic/LatestWorkCarousel';

/**
 * Weave creative work and hire stock into one showcase rail.
 *
 * The home page used to advertise gear with four tiles of text — "Categories
 * 6+", "Day Rates From R500" — while the carousel showed only productions. The
 * business that earns most was the one nobody could see. Alternating the two
 * means a visitor meets the work and the kit in the same scroll.
 *
 * Work leads, then gear, then work again. When one list runs out the remainder
 * of the other is appended rather than dropped, so a thin catalogue still
 * produces a full rail instead of a short one.
 */
export function interleaveShowcase(
  productions: CarouselItem[],
  rentals: CarouselItem[],
): CarouselItem[] {
  const out: CarouselItem[] = [];
  const longest = Math.max(productions.length, rentals.length);

  for (let i = 0; i < longest; i++) {
    if (i < productions.length) out.push(productions[i]);
    if (i < rentals.length) out.push(rentals[i]);
  }

  return out;
}
