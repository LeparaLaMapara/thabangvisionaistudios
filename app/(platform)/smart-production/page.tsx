export const revalidate = 60;

import SmartProductionClient from './SmartProductionClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { getPublishedCategories, getProductionCountsByCategory } from '@/lib/supabase/queries/productionCategories';
import { getFeaturedProductions } from '@/lib/supabase/queries/smartProductions';
import { PRODUCTION_CATEGORIES } from '@/lib/constants';
import type { ProductionCategory } from '@/types/production';

export const metadata = {
  title: 'Smart Productions — Photography & Video Production Services',
};

export default async function SmartProductionPage() {
  // Fetch categories from DB — fall back to constants if table not migrated yet
  let categories: ProductionCategory[];
  try {
    const dbCategories = await getPublishedCategories();
    categories = dbCategories.length > 0 ? dbCategories : PRODUCTION_CATEGORIES;
  } catch {
    categories = PRODUCTION_CATEGORIES;
  }

  // Fetch production counts + featured productions in parallel
  const [productionCounts, featuredProductions] = await Promise.all([
    getProductionCountsByCategory(),
    getFeaturedProductions(6),
  ]);

  return (
    <>
      <SmartProductionClient
        categories={categories}
        productionCounts={productionCounts}
        featuredProductions={featuredProductions}
      />
      <AskUbunyeButton prompt="I need a quote for a production" label="Get an instant AI quote" />
    </>
  );
}
