export const revalidate = 60;

import { getFeaturedProductions } from '@/lib/supabase/queries/smartProductions';
import { getShowcaseRentals, getRentalPriceRange } from '@/lib/supabase/queries/smartRentals';
import { formatRand } from '@/lib/format/money';
import { onlinePaymentsOpen } from '@/lib/payments/status';
import { interleaveShowcase } from '@/lib/home/showcase';
import HomeClient from './HomeClient';
import type { CarouselItem } from '@/components/cinematic/LatestWorkCarousel';
import { getFlag } from '@/lib/features';

/** Build a Cloudinary delivery URL from a public_id. */
function cloudinaryUrl(publicId: string): string {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  return `https://res.cloudinary.com/${cloud}/image/upload/${publicId}`;
}

/**
 * Resolve the best available image for a DB row.
 * Priority: thumbnail_url → cover_public_id (build URL) → first gallery image → null.
 */
function resolveImage(
  thumbnailUrl: string | null | undefined,
  coverPublicId: string | null | undefined,
  gallery: { url: string; public_id: string }[] | null | undefined,
): string | null {
  if (thumbnailUrl) return thumbnailUrl;
  if (coverPublicId) return cloudinaryUrl(coverPublicId);
  if (gallery && gallery.length > 0) return gallery[0].url;
  return null;
}

export default async function Home() {
  const [smartProductionsEnabled, appsEnabled] = await Promise.all([
    getFlag('smart_productions'),
    getFlag('creative_tools'),
  ]);

  const [productions, rentals, priceRange] = await Promise.all([
    smartProductionsEnabled ? getFeaturedProductions(8) : Promise.resolve([]),
    getShowcaseRentals(8),
    getRentalPriceRange(),
  ]);

  const productionItems: CarouselItem[] = productions.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    thumbnail_url: resolveImage(p.thumbnail_url, p.cover_public_id, p.gallery),
    video_url: p.video_url,
    tags: p.tags ?? [],
    category: 'production' as const,
    meta: [p.client, p.year].filter(Boolean).join(' / ') || 'Production',
    created_at: p.created_at,
  })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const rentalItems: CarouselItem[] = rentals.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    thumbnail_url: resolveImage(r.thumbnail_url, r.cover_public_id, r.gallery),
    video_url: r.video_url,
    tags: r.tags ?? [],
    category: 'rental' as const,
    // smart_rentals.category already holds the URL slug the rental routes use
    // (/rentals/[category]/[slug]), so it doubles as the link segment.
    categorySlug: r.category,
    meta: [r.brand, r.price_per_day ? `${formatRand(Number(r.price_per_day))} a day` : null]
      .filter(Boolean).join(' / ') || 'Rental',
    created_at: r.created_at,
  }));

  // Work first, then gear, alternating — see lib/home/showcase.ts.
  const carouselItems = interleaveShowcase(productionItems, rentalItems);

  return (
    <HomeClient
      carouselItems={carouselItems}
      minDayRate={priceRange?.min ?? null}
      paymentsOpen={onlinePaymentsOpen()}
      showApps={appsEnabled}
    />
  );
}
