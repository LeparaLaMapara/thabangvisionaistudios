export const revalidate = 60;

import { notFound } from 'next/navigation';
import { PRODUCTION_CATEGORIES } from '@/lib/constants';
import { getCategoryBySlug } from '@/lib/supabase/queries/productionCategories';
import { getProductionsByType } from '@/lib/supabase/queries/smartProductions';
import ProductionCategoryClient from './ProductionCategoryClient';
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

  const productions = await getProductionsByType(category.projectType);

  return (
    <>
      <ProductionCategoryClient
        category={category}
        productions={productions}
      />
      <AskUbunyeButton
        prompt={`I need a quote for ${category.name.toLowerCase()} production services`}
        label="Get an instant AI quote"
      />
    </>
  );
}
