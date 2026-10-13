import type { Metadata } from 'next';
import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { getRentalBySlug, getRelatedRentals, getRentalOwner } from '@/lib/supabase/queries/smartRentals';
import RentalDetailView from './RentalDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { onlinePaymentsOpen } from '@/lib/payments/status';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { buildPageMetadata, metaDescription } from '@/lib/seo/metadata';
import { productJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { formatRand } from '@/lib/format/money';
import { collectionPointWithCity } from '@/lib/rental/collection-point';

export const revalidate = 60;

/** The one address of a rental item: its own category, then its slug. */
function rentalPath(rental: { category: string | null; slug: string }): string {
  return `/rentals/${encodeURIComponent(rental.category ?? '')}/${encodeURIComponent(rental.slug)}`;
}

/** The browser tab and search result name the item, not the site in general. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const rental = await getRentalBySlug(slug);
  if (!rental) return {};
  const cat = RENTAL_CATEGORIES.find((c) => c.value === rental.category);
  const price = rental.price_per_day && rental.price_per_day > 0
    ? ` From ${formatRand(rental.price_per_day)} a day.`
    : '';
  const fallback = `Hire the ${rental.title}${cat ? ` (${cat.label})` : ''} from ${STUDIO.name}.${price} Collect at ${collectionPointWithCity()} or have it delivered.`;
  return buildPageMetadata({
    title: rental.title,
    description: metaDescription(rental.description, fallback),
    path: rentalPath(rental),
    imageUrl: rental.thumbnail_url ?? undefined,
    imageAlt: rental.title,
  });
}

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;

  if (category === 'crew-services') {
    redirect('/studio');
  }

  // Same call as generateMetadata; getRentalBySlug is cache()-wrapped, so this
  // reuses that result instead of querying again.
  const rental = await getRentalBySlug(slug);

  if (!rental) notFound();

  // The item answered under ANY category path, so one item had as many
  // addresses as there are categories. Send every other form to the real one.
  if (rental.category && category !== rental.category) {
    permanentRedirect(rentalPath(rental));
  }

  const [relatedRentals, owner] = await Promise.all([
    getRelatedRentals(rental.category, rental.id, 4),
    // Studio stock passes null and short-circuits inside the query.
    getRentalOwner(rental.owner_type === 'community' ? rental.owner_id : null),
  ]);

  const cat = RENTAL_CATEGORIES.find((c) => c.value === rental.category);
  const jsonLd = [
    productJsonLd({
      title: rental.title,
      slug: rental.slug,
      category: rental.category,
      categoryLabel: cat?.label ?? null,
      description: rental.description,
      price_per_day: rental.price_per_day,
      thumbnail_url: rental.thumbnail_url,
      gallery: rental.gallery,
      is_available: rental.is_available,
      brand: rental.brand,
      model: rental.model,
      average_rating: rental.average_rating,
      review_count: rental.review_count,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: STUDIO.meta.url },
      { name: 'Rentals', url: `${STUDIO.meta.url}/rentals` },
      ...(cat ? [{ name: cat.label, url: `${STUDIO.meta.url}/rentals/${cat.value}` }] : []),
      { name: rental.title, url: `${STUDIO.meta.url}${rentalPath(rental)}` },
    ]),
  ];

  return (
    <>
      {jsonLd.map((ld, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(ld) }}
        />
      ))}
      <RentalDetailView
        rental={rental}
        category={rental.category ?? category}
        relatedRentals={relatedRentals}
        owner={owner}
        paymentsOpen={onlinePaymentsOpen()}
      />
      <AskUbunyeButton raised
        prompt={`Tell me more about the ${rental.title} and what it's best for`}
        label="Questions about this gear?"
      />
      {/* No exit-intent modal here: this page is the start of a booking, and a
          pop-up on the way to the date picker is an interruption, not help
          (spec 9.5, no unnecessary modal chains). The Ask Ubunye button above
          already offers the same route. */}
    </>
  );
}
