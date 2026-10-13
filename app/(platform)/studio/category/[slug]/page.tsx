export const revalidate = 60;

import { notFound } from 'next/navigation';
import { PRODUCTION_CATEGORIES, PRODUCTION_PACKAGES, STUDIO } from '@/lib/constants';
import { getCategoryBySlug } from '@/lib/supabase/queries/productionCategories';
import { getStudioProductionsByType, getCreatorProductionsByType } from '@/lib/supabase/queries/smartProductions';
import { getCrewBySpecializations } from '@/lib/supabase/queries/crew';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { serviceJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import CategoryPageClient from './CategoryPageClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { categoryFromPrice } from '@/lib/productions/from-price';
import { formatRand } from '@/lib/format/money';
import { RelatedCategories } from '@/components/seo/RelatedCategories';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;

  const dbCategory = await getCategoryBySlug(slug);
  const category = dbCategory ?? PRODUCTION_CATEGORIES.find((c) => c.slug === slug);

  if (!category) return { title: 'Category Not Found' };
  return buildPageMetadata({
    title: `${category.name} — Production Services`,
    description: (() => {
      const from = categoryFromPrice(PRODUCTION_PACKAGES.filter((p) => p.category === slug));
      return `${category.description} By request in ${STUDIO.serviceArea.province}${from !== null ? `, from ${formatRand(from)}` : ''}.`;
    })(),
    path: `/studio/category/${slug}`,
    markdown: true,
    imageUrl: category.coverImageUrl ?? undefined,
  });
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;

  const dbCategory = await getCategoryBySlug(slug);
  const category = dbCategory ?? PRODUCTION_CATEGORIES.find((c) => c.slug === slug);
  if (!category) notFound();

  const packages = PRODUCTION_PACKAGES.filter((p) => p.category === slug);

  const [productions, creatorProductions, creators] = await Promise.all([
    getStudioProductionsByType(category.projectType),
    getCreatorProductionsByType(category.projectType),
    getCrewBySpecializations(category.creatorKeywords),
  ]);

  const jsonLd = [
    serviceJsonLd({
      name: `${category.name} Production Services`,
      description: category.description,
      url: `${STUDIO.meta.url}/studio/category/${slug}`,
      startingRate: categoryFromPrice(packages) ?? undefined,
      imageUrl: category.coverImageUrl ?? undefined,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: STUDIO.meta.url },
      { name: 'Studio', url: `${STUDIO.meta.url}/studio` },
      { name: category.name, url: `${STUDIO.meta.url}/studio/category/${slug}` },
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
      />
      <RelatedCategories currentSlug={slug} type="studio" />
      <AskUbunyeButton
        prompt={`I need a quote for ${category.name.toLowerCase()} production services`}
        label="Ask Ubunye about this"
      />
    </>
  );
}
