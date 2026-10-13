import { redirect } from 'next/navigation';
import { fetchAllPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { serviceJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import AllGearClient from '../AllGearClient';
import { RelatedCategories } from '@/components/seo/RelatedCategories';
import { collectionPointWithCity } from '@/lib/rental/collection-point';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const cat = RENTAL_CATEGORIES.find((c) => c.value === category);
  if (!cat) return { title: 'Rentals' };

  return buildPageMetadata({
    title: `${cat.label} Rentals — Equipment Hire`,
    description: `${cat.description} Collect at ${collectionPointWithCity()}; delivery within ${STUDIO.fulfilment.delivery.maxRadiusKm} km after your first hire. Daily rates, book online with ${STUDIO.name}.`,
    path: `/rentals/${category}`,
  });
}

export default async function RentalCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;

  if (category === 'crew-services') {
    redirect('/studio');
  }

  const cat = RENTAL_CATEGORIES.find((c) => c.value === category);
  // The same all-gear page as /rentals, opened on this category's filter.
  const { rentals, failed } = await fetchAllPublishedRentals();

  const jsonLd = cat ? [
    serviceJsonLd({
      name: `${cat.label} Rentals`,
      description: cat.description,
      url: `${STUDIO.meta.url}/rentals/${category}`,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: STUDIO.meta.url },
      { name: 'Rentals', url: `${STUDIO.meta.url}/rentals` },
      { name: cat.label, url: `${STUDIO.meta.url}/rentals/${category}` },
    ]),
  ] : [];

  return (
    <>
      {jsonLd.map((ld, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(ld) }}
        />
      ))}
      <AllGearClient rentals={rentals} initialCategory={category} loadFailed={failed} />
      <RelatedCategories currentSlug={category} type="rentals" />
    </>
  );
}
