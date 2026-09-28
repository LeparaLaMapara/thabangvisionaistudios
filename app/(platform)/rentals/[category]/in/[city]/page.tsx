export const revalidate = 60;

import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { getPublishedRentalsByCategory } from '@/lib/supabase/queries/smartRentals';
import { getCityBySlug, COUNTRY_SLUG, deliversRentals } from '@/lib/seo/cities';
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

  const city = getCityBySlug(citySlug);
  if (!city) return { title: 'Not Found' };
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

  // There is no "All South Africa": delivery reaches about 100 km.
  if (citySlug === COUNTRY_SLUG) permanentRedirect(`/rentals/${category}`);
  const city = getCityBySlug(citySlug);
  if (!city) notFound();
  // Gear does not reach this city: send people to the category, not a page
  // that lists Johannesburg stock under another city's name.
  if (!deliversRentals(city)) permanentRedirect(`/rentals/${category}`);

  const locationName = city.name;

  const rentals = await getPublishedRentalsByCategory(category);

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
      />
      <RelatedCategories currentSlug={category} type="rentals" locationSlug={citySlug} />
    </>
  );
}
