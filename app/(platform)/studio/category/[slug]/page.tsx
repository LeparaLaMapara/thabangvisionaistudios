export const revalidate = 60;

import { notFound } from 'next/navigation';
import { PRODUCTION_CATEGORIES, PRODUCTION_PACKAGES } from '@/lib/constants';
import { getCategoryBySlug } from '@/lib/supabase/queries/productionCategories';
import { getStudioProductionsByType, getCreatorProductionsByType } from '@/lib/supabase/queries/smartProductions';
import { getCrewBySpecializations } from '@/lib/supabase/queries/crew';
import CategoryPageClient from './CategoryPageClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;

  const dbCategory = await getCategoryBySlug(slug);
  const category = dbCategory ?? PRODUCTION_CATEGORIES.find((c) => c.slug === slug);

  if (!category) return { title: 'Category Not Found' };
  return {
    title: `${category.name} — Smart Productions`,
    description: category.description,
  };
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

  return (
    <>
      <CategoryPageClient
        category={category}
        packages={packages}
        productions={[...productions, ...creatorProductions]}
        creators={creators}
      />
      <AskUbunyeButton
        prompt={`I need a quote for ${category.name.toLowerCase()} production services`}
        label="Get an instant AI quote"
      />
    </>
  );
}
