export const revalidate = 60;

import { getShowcaseRentals, getRentalPriceRange } from '@/lib/supabase/queries/smartRentals';
import { formatRand } from '@/lib/format/money';
import { onlinePaymentsOpen } from '@/lib/payments/status';
import HomeClient from './HomeClient';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO, SITE_TAGLINE } from '@/lib/constants';
import type { CarouselItem } from '@/components/cinematic/LatestWorkCarousel';
import { getFlag } from '@/lib/features';
import { getOfferedRoles, listApprovedProfiles } from '@/lib/supabase/queries/roles';
import { formatRolePrice } from '@/lib/roles/pricing';
import { peopleWords } from '@/lib/roles/offered';

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

export const metadata = {
  ...buildPageMetadata({
    title: `${STUDIO.shortName} | ${SITE_TAGLINE}`,
    description: STUDIO.meta.description,
    path: '/',
  }),
  // The home page keeps the full name; the "%s | BRAND" template would repeat it.
  title: { absolute: `${STUDIO.shortName} | ${SITE_TAGLINE}` },
};

export default async function Home() {
  const rolesEnabled = await getFlag('roles_v1');

  const [rentals, priceRange, roles, profiles] = await Promise.all([
    getShowcaseRentals(8),
    getRentalPriceRange(),
    rolesEnabled ? getOfferedRoles() : Promise.resolve(null),
    rolesEnabled ? listApprovedProfiles() : Promise.resolve([]),
  ]);
  // People: name only the kinds of work someone approved offers.
  const people = roles ? peopleWords(roles.offered, roles.live) : undefined;

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

  // One People row (roles_v1): blind cards, the same as /people.
  const peopleCards = profiles.slice(0, 4).map((c) => ({
    id: c.id,
    label: c.label,
    cover: c.cover,
    price: c.priceCents !== null ? formatRolePrice(c.unit, c.priceCents, c.perKmCents) : null,
  }));

  return (
    <HomeClient
      carouselItems={rentalItems}
      peopleCards={peopleCards}
      minDayRate={priceRange?.min ?? null}
      paymentsOpen={onlinePaymentsOpen()}
      rolesOn={rolesEnabled}
      people={people}
    />
  );
}
