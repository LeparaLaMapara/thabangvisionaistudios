export const revalidate = 60;
// No generateStaticParams (repo rule) and dynamicParams stays true, so any
// city slug reaches the page and a retired one gets its 308 instead of a 404.
export const dynamicParams = true;

import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { fetchPublishedRentalsByCategory } from '@/lib/supabase/queries/smartRentals';
import { getListedCityBySlug } from '@/lib/seo/cities';
import { collectionPointWithCity } from '@/lib/rental/collection-point';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { serviceJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import RentalCategoryClient from '../../RentalCategoryClient';
import { RelatedCategories } from '@/components/seo/RelatedCategories';

interface Props {
  params: Promise<{ category: string; city: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { category, city: citySlug } = await params;

  const cat = RENTAL_CATEGORIES.find((c) => c.value === category);
  if (!cat) return { title: 'Not Found' };

  // Pages exist only for listed Gauteng cities; see the page below.
  const city = getListedCityBySlug(citySlug);
  if (!city) permanentRedirect(`/rentals/${category}`);
  const locationName = city.name;

  const title = `${cat.label} Rentals in ${locationName}`;
  const description = `Browse ${cat.label.toLowerCase()} for hire. ${cat.description} Collected at ${collectionPointWithCity()}; delivery within ${STUDIO.fulfilment.delivery.maxRadiusKm} km after your first hire. Book online with ${STUDIO.name}.`;

  return buildPageMetadata({
    title,
    description,
    path: `/rentals/${category}/in/${citySlug}`,
    type: 'website',
  });
}

export default async function RentalLocationPage({ params }: Props) {
  const { category, city: citySlug } = await params;

  if (category === 'crew-services') redirect('/studio');

  const cat = RENTAL_CATEGORIES.find((c) => c.value === category);
  if (!cat) notFound();

  // We work in Gauteng. A city outside it, the old "south-africa" slug or an
  // unknown slug gets a 308 to the category page, not a page that lists
  // Johannesburg stock under another city's name.
  const city = getListedCityBySlug(citySlug);
  if (!city) permanentRedirect(`/rentals/${category}`);

  const locationName = city.name;

  // Same read as the category page: a failed read shows an error with a retry,
  // not "nothing here", and a capped list says there is more.
  const { rentals, failed, hasMore } = await fetchPublishedRentalsByCategory(category);

  const jsonLd = [
    serviceJsonLd({
      name: `${cat.label} Rentals in ${locationName}`,
      description: `${cat.description} Collected at ${collectionPointWithCity()}.`,
      url: `${STUDIO.meta.url}/rentals/${category}/in/${citySlug}`,
      city: city.name,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: STUDIO.meta.url },
      { name: 'Rentals', url: `${STUDIO.meta.url}/rentals` },
      { name: cat.label, url: `${STUDIO.meta.url}/rentals/${category}` },
      { name: locationName, url: `${STUDIO.meta.url}/rentals/${category}/in/${citySlug}` },
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
      <RentalCategoryClient
        rentals={rentals}
        category={category}
        locationName={locationName}
        loadFailed={failed}
        hasMore={hasMore}
      />
      <RelatedCategories currentSlug={category} type="rentals" locationSlug={citySlug} />
    </>
  );
}
