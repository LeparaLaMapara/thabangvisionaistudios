export const revalidate = 60;

import { notFound } from 'next/navigation';
import { PRODUCTION_CATEGORIES } from '@/lib/constants';
import { getCrewBySpecializations } from '@/lib/supabase/queries/crew';
import ProductionCategoryClient from './ProductionCategoryClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const category = PRODUCTION_CATEGORIES.find((c) => c.slug === slug);
  if (!category) return { title: 'Category Not Found' };
  return {
    title: `${category.name} — Smart Productions`,
    description: category.description,
  };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = PRODUCTION_CATEGORIES.find((c) => c.slug === slug);
  if (!category) notFound();

  // Fetch community creators matching this category's keywords
  const crew = await getCrewBySpecializations(category.creatorKeywords, 12);

  return (
    <>
      <ProductionCategoryClient category={category} crew={crew} />
      <AskUbunyeButton
        prompt={`I need a quote for ${category.name.toLowerCase()} production services`}
        label="Get an instant AI quote"
      />
    </>
  );
}
