import { redirect } from 'next/navigation';
import { getPublishedRentalsByCategory } from '@/lib/supabase/queries/smartRentals';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { serviceJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import RentalCategoryClient from './RentalCategoryClient';
import { AlsoAvailableIn } from '@/components/seo/AlsoAvailableIn';
import { RENTAL_CITIES } from '@/lib/seo/cities';
import { RelatedCategories } from '@/components/seo/RelatedCategories';

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
    description: `${cat.description} Collect in Johannesburg or have it delivered within ${STUDIO.fulfilment.delivery.maxRadiusKm} km. Daily rates, book online with ThabangVision.`,
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
  const rentals = await getPublishedRentalsByCategory(category);

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
      <RentalCategoryClient rentals={rentals} category={category} />
      <AlsoAvailableIn basePath={`/rentals/${category}`} cities={RENTAL_CITIES} />
      <RelatedCategories currentSlug={category} type="rentals" />
    </>
  );
}
