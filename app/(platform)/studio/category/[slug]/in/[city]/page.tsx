export const revalidate = 60;
// No generateStaticParams (repo rule) and dynamicParams stays true, so any
// city slug reaches the page and a retired one gets its 308 instead of a 404.
export const dynamicParams = true;

import { notFound, permanentRedirect } from 'next/navigation';
import { PRODUCTION_CATEGORIES, PRODUCTION_PACKAGES, STUDIO } from '@/lib/constants';
import { getCategoryBySlug } from '@/lib/supabase/queries/productionCategories';
import { getStudioProductionsByType, getCreatorProductionsByType } from '@/lib/supabase/queries/smartProductions';
import { getCrewBySpecializationsAndLocation } from '@/lib/supabase/queries/crew';
import { getListedCityBySlug } from '@/lib/seo/cities';
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

  // Pages exist only for listed Gauteng cities; see the page below.
  const city = getListedCityBySlug(citySlug);
  if (!city) permanentRedirect(`/studio/category/${slug}`);
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

  // We work in Gauteng; city pages exist only for the listed Gauteng cities
  // that have a creator (below). A city outside Gauteng, the old
  // "south-africa" slug or an unknown slug gets a 308 to the category page.
  const city = getListedCityBySlug(citySlug);
  if (!city) permanentRedirect(`/studio/category/${slug}`);

  const locationName = city.name;
  const packages = PRODUCTION_PACKAGES.filter((p) => p.category === slug);

  const [productions, creatorProductions, creators] = await Promise.all([
    getStudioProductionsByType(category.projectType),
    getCreatorProductionsByType(category.projectType),
    getCrewBySpecializationsAndLocation(category.creatorKeywords, city.name),
  ]);

  // A studio city page exists only when at least one listed creator in this
  // category is based in this city. Without one, the page would be the
  // category page under a city's name (a doorway page), so it redirects to
  // the category page and stays out of the sitemap. It appears on its own
  // once such a creator is listed.
  if (creators.length === 0) permanentRedirect(`/studio/category/${slug}`);

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
