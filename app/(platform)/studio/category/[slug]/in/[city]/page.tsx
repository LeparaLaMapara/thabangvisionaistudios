export const revalidate = 60;

import { notFound } from 'next/navigation';
import { PRODUCTION_CATEGORIES, PRODUCTION_PACKAGES, STUDIO } from '@/lib/constants';
import { getCategoryBySlug } from '@/lib/supabase/queries/productionCategories';
import { getStudioProductionsByType, getCreatorProductionsByType } from '@/lib/supabase/queries/smartProductions';
import { getCrewBySpecializationsAndLocation, getCrewBySpecializations } from '@/lib/supabase/queries/crew';
import { getCityBySlug, COUNTRY_SLUG, COUNTRY_NAME } from '@/lib/seo/cities';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { serviceJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import CategoryPageClient from '../../CategoryPageClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { AlsoAvailableIn } from '@/components/seo/AlsoAvailableIn';
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
  const locationName = city?.name ?? (citySlug === COUNTRY_SLUG ? COUNTRY_NAME : null);
  if (!locationName) return { title: 'Not Found' };

  const title = `${category.name} in ${locationName}`;
  const description = `Find ${category.name.toLowerCase()} professionals in ${locationName}. ${category.description} Book online with ThabangVision.`;

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

  const city = getCityBySlug(citySlug);
  const isCountry = citySlug === COUNTRY_SLUG;
  if (!city && !isCountry) notFound();

  const locationName = city?.name ?? COUNTRY_NAME;
  const packages = PRODUCTION_PACKAGES.filter((p) => p.category === slug);

  const [productions, creatorProductions, creators] = await Promise.all([
    getStudioProductionsByType(category.projectType),
    getCreatorProductionsByType(category.projectType),
    city
      ? getCrewBySpecializationsAndLocation(category.creatorKeywords, city.name)
      : getCrewBySpecializations(category.creatorKeywords),
  ]);

  const jsonLd = [
    serviceJsonLd({
      name: `${category.name} in ${locationName}`,
      description: `${category.description} Available in ${locationName}.`,
      url: `${STUDIO.meta.url}/studio/category/${slug}/in/${citySlug}`,
      startingRate: category.startingRate,
      imageUrl: category.coverImageUrl ?? undefined,
      city: city?.name,
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
      <AlsoAvailableIn basePath={`/studio/category/${slug}`} currentCitySlug={citySlug} />
      <RelatedCategories currentSlug={slug} type="studio" locationSlug={citySlug} />
      <AskUbunyeButton
        prompt={`I need a quote for ${category.name.toLowerCase()} in ${locationName}`}
        label="Get an instant AI quote"
      />
    </>
  );
}
