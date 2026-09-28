export const revalidate = 60;

import { notFound, permanentRedirect } from 'next/navigation';
import { PRODUCTION_CATEGORIES, PRODUCTION_PACKAGES, STUDIO } from '@/lib/constants';
import { getCategoryBySlug } from '@/lib/supabase/queries/productionCategories';
import { getStudioProductionsByType, getCreatorProductionsByType } from '@/lib/supabase/queries/smartProductions';
import { getCrewBySpecializationsAndLocation } from '@/lib/supabase/queries/crew';
import { getCityBySlug, COUNTRY_SLUG, deliversRentals } from '@/lib/seo/cities';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { serviceJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import CategoryPageClient from '../../CategoryPageClient';
import { categoryFromPrice } from '@/lib/productions/from-price';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { RelatedCategories } from '@/components/seo/RelatedCategories';

interface Props {
  params: Promise<{ slug: string; city: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug, city: citySlug } = await params;

  const dbCategory = await getCategoryBySlug(slug);
  const category = dbCategory ?? PRODUCTION_CATEGORIES.find((c) => c.slug === slug);
  if (!category) return { title: 'Not Found' };

  const city = getCityBySlug(citySlug);
  if (!city) return { title: 'Not Found' };
  const locationName = city.name;

  const title = `${category.name} in ${locationName}`;
  const description = `${category.name} by request in ${locationName}. ${category.description} Send a request and we confirm the shoot with you.`;

  return buildPageMetadata({
    title,
    description,
    path: `/studio/category/${slug}/in/${citySlug}`,
    imageUrl: category.coverImageUrl ?? undefined,
    type: 'website',
  });
}

export default async function StudioLocationPage({ params }: Props) {
  const { slug, city: citySlug } = await params;

  const dbCategory = await getCategoryBySlug(slug);
  const category = dbCategory ?? PRODUCTION_CATEGORIES.find((c) => c.slug === slug);
  if (!category) notFound();

  // City pages are kept for search in the Johannesburg area only (the same
  // Gauteng cities gear reaches). Everywhere else, and "All South Africa",
  // goes to the category page: no creators are listed in other cities.
  if (citySlug === COUNTRY_SLUG) permanentRedirect(`/studio/category/${slug}`);
  const city = getCityBySlug(citySlug);
  if (!city) notFound();
  if (!deliversRentals(city)) permanentRedirect(`/studio/category/${slug}`);

  const locationName = city.name;
  const packages = PRODUCTION_PACKAGES.filter((p) => p.category === slug);

  const [productions, creatorProductions, creators] = await Promise.all([
    getStudioProductionsByType(category.projectType),
    getCreatorProductionsByType(category.projectType),
    getCrewBySpecializationsAndLocation(category.creatorKeywords, city.name),
  ]);

  const jsonLd = [
    serviceJsonLd({
      name: `${category.name} in ${locationName}`,
      description: `${category.description} By request in ${locationName}.`,
      url: `${STUDIO.meta.url}/studio/category/${slug}/in/${citySlug}`,
      startingRate: categoryFromPrice(packages) ?? undefined,
      imageUrl: category.coverImageUrl ?? undefined,
      city: city.name,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: STUDIO.meta.url },
      { name: 'Studio', url: `${STUDIO.meta.url}/studio` },
      { name: category.name, url: `${STUDIO.meta.url}/studio/category/${slug}` },
      { name: locationName, url: `${STUDIO.meta.url}/studio/category/${slug}/in/${citySlug}` },
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
      <CategoryPageClient
        category={category}
        packages={packages}
        productions={[...productions, ...creatorProductions]}
        creators={creators}
        locationName={locationName}
      />
      <RelatedCategories currentSlug={slug} type="studio" locationSlug={citySlug} />
      <AskUbunyeButton
        prompt={`I need a quote for ${category.name.toLowerCase()} in ${locationName}`}
        label="Ask Ubunye about this"
      />
    </>
  );
}
