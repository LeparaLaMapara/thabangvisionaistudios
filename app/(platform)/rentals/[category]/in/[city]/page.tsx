export const revalidate = 60;

import { notFound, redirect } from 'next/navigation';
import { getPublishedRentalsByCategory } from '@/lib/supabase/queries/smartRentals';
import { getCrewByLocation } from '@/lib/supabase/queries/crew';
import { getCityBySlug, COUNTRY_SLUG, COUNTRY_NAME, SA_CITIES } from '@/lib/seo/cities';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { serviceJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import RentalCategoryClient from '../../RentalCategoryClient';
import { AlsoAvailableIn } from '@/components/seo/AlsoAvailableIn';
import { RelatedCategories } from '@/components/seo/RelatedCategories';

interface Props {
  params: Promise<{ category: string; city: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { category, city: citySlug } = await params;

  const cat = RENTAL_CATEGORIES.find((c) => c.value === category);
  if (!cat) return { title: 'Not Found' };

  const city = getCityBySlug(citySlug);
  const locationName = city?.name ?? (citySlug === COUNTRY_SLUG ? COUNTRY_NAME : null);
  if (!locationName) return { title: 'Not Found' };

  const title = `${cat.label} Rentals in ${locationName}`;
  const description = `Browse ${cat.label.toLowerCase()} available for hire in ${locationName}. ${cat.description} Book online with ThabangVision.`;

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

  const city = getCityBySlug(citySlug);
  const isCountry = citySlug === COUNTRY_SLUG;
  if (!city && !isCountry) notFound();

  const locationName = city?.name ?? COUNTRY_NAME;

  const rentals = await getPublishedRentalsByCategory(category);

  const jsonLd = [
    serviceJsonLd({
      name: `${cat.label} Rentals in ${locationName}`,
      description: `${cat.description} Available for hire in ${locationName}.`,
      url: `${STUDIO.meta.url}/rentals/${category}/in/${citySlug}`,
      city: city?.name,
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
      <AlsoAvailableIn basePath={`/rentals/${category}`} currentCitySlug={citySlug} />
      <RelatedCategories currentSlug={category} type="rentals" locationSlug={citySlug} />
    </>
  );
}
