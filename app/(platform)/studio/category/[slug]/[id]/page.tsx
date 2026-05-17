export const revalidate = 60;

import { notFound } from 'next/navigation';
import { PRODUCTION_CATEGORIES, PRODUCTION_PACKAGES } from '@/lib/constants';
import { getCrewBySlug, getCrewPortfolio, getCrewReviews } from '@/lib/supabase/queries/crew';
import { getProductionsByType } from '@/lib/supabase/queries/smartProductions';
import ProductionPackageDetailView from './ProductionPackageDetailView';
import ProductionCreatorDetailView from './ProductionCreatorDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

interface Props {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug, id } = await params;
  const category = PRODUCTION_CATEGORIES.find((c) => c.slug === slug);

  // Check if it's a studio package
  const pkg = PRODUCTION_PACKAGES.find((p) => p.id === id && p.category === slug);
  if (pkg) {
    return { title: `${pkg.name} — ${category?.name ?? 'Productions'}` };
  }

  // Otherwise it's a community creator
  const crew = await getCrewBySlug(id);
  if (crew) {
    const spec = crew.specializations[0] ?? 'Creator';
    return { title: `${spec} — ${category?.name ?? 'Productions'}` };
  }

  return { title: 'Not Found' };
}

export default async function ProductionDetailPage({ params }: Props) {
  const { slug, id } = await params;
  const category = PRODUCTION_CATEGORIES.find((c) => c.slug === slug);
  if (!category) notFound();

  // ── Studio package ──────────────────────────────────────────────────────────
  const pkg = PRODUCTION_PACKAGES.find((p) => p.id === id && p.category === slug);
  if (pkg) {
    // Fetch studio portfolio work + related packages in parallel
    const [productions, relatedPackages] = await Promise.all([
      getProductionsByType(category.projectType),
      Promise.resolve(
        PRODUCTION_PACKAGES.filter((p) => p.category === slug && p.id !== id),
      ),
    ]);

    return (
      <>
        <ProductionPackageDetailView
          pkg={pkg}
          category={category}
          productions={productions}
          relatedPackages={relatedPackages}
        />
        <AskUbunyeButton
          prompt={`Tell me more about the ${pkg.name} package and what's included`}
          label="Questions about this package?"
        />
      </>
    );
  }

  // ── Community creator ───────────────────────────────────────────────────────
  const crew = await getCrewBySlug(id);
  if (!crew) notFound();

  const [portfolio, reviews] = await Promise.all([
    getCrewPortfolio(crew.id),
    getCrewReviews(crew.id),
  ]);

  return (
    <>
      <ProductionCreatorDetailView
        crew={crew}
        portfolio={portfolio}
        reviews={reviews}
        category={category}
      />
      <AskUbunyeButton
        prompt="Tell me about this creator's work and specializations"
        label="Questions about this creator?"
      />
    </>
  );
}
