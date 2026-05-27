export const revalidate = 60;

import { notFound } from 'next/navigation';
import { PRODUCTION_CATEGORIES, PRODUCTION_PACKAGES, STUDIO } from '@/lib/constants';
import { getCrewBySlug, getCrewPortfolio, getCrewReviews } from '@/lib/supabase/queries/crew';
import { getProductionsByType } from '@/lib/supabase/queries/smartProductions';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { personJsonLd, aggregateRatingJsonLd, breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import ProductionPackageDetailView from './ProductionPackageDetailView';
import ProductionCreatorDetailView from './ProductionCreatorDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

interface Props {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug, id } = await params;
  const category = PRODUCTION_CATEGORIES.find((c) => c.slug === slug);

  const pkg = PRODUCTION_PACKAGES.find((p) => p.id === id && p.category === slug);
  if (pkg) {
    return buildPageMetadata({
      title: `${pkg.name} — ${category?.name ?? 'Productions'}`,
      description: pkg.description ?? `${pkg.name} production package by ${STUDIO.shortName}.`,
      path: `/studio/category/${slug}/${id}`,
    });
  }

  const crew = await getCrewBySlug(id);
  if (crew) {
    const name = crew.display_name ?? 'Creator';
    const spec = crew.specializations.join(', ') || 'Creative Professional';
    return buildPageMetadata({
      title: `${name} — ${spec}`,
      description: `Book ${name} for ${spec.toLowerCase()} in ${crew.location ?? 'South Africa'}. View portfolio, reviews, and rates on ${STUDIO.shortName}.`,
      path: `/studio/category/${slug}/${id}`,
      imageUrl: crew.avatar_url ?? undefined,
    });
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

  const creatorUrl = `${STUDIO.meta.url}/studio/category/${slug}/${id}`;
  const creatorName = crew.display_name ?? 'Creator';
  const jsonLd = [
    personJsonLd({
      display_name: crew.display_name,
      crew_slug: crew.crew_slug,
      specializations: crew.specializations,
      hourly_rate: crew.hourly_rate,
      location: crew.location,
      avatar_url: crew.avatar_url,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: STUDIO.meta.url },
      { name: 'Studio', url: `${STUDIO.meta.url}/studio` },
      { name: category.name, url: `${STUDIO.meta.url}/studio/category/${slug}` },
      { name: creatorName, url: creatorUrl },
    ]),
    ...(reviews.length > 0
      ? [
          aggregateRatingJsonLd({
            name: creatorName,
            url: creatorUrl,
            ratingValue:
              Math.round(
                (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10,
              ) / 10,
            reviewCount: reviews.length,
            reviews: reviews.map((r) => ({
              rating: r.rating,
              author: r.reviewer_name,
              comment: r.comment,
              date: r.created_at,
            })),
          }),
        ]
      : []),
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
