import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductionBySlug } from '@/lib/supabase/queries/smartProductions';
import ProductionDetailView from './ProductionDetailView';

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project   = await getProductionBySlug(slug);
  return { title: project?.title ?? 'Production' };
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Server Component — fetches a single published production by slug and passes
 * it to ProductionDetailView for rendering.
 * Returns a 404 if the slug is not found or the project is unpublished.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project   = await getProductionBySlug(slug);

  if (!project) notFound();

  return <ProductionDetailView project={project} />;
}
