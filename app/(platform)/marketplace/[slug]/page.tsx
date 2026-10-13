import { notFound } from 'next/navigation';
import { getListingBySlug } from '@/lib/supabase/queries/marketplace';
import ListingDetailView from './ListingDetailView';
import { buildPageMetadata, metaDescription } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: 'Listing Not Found' };
  return buildPageMetadata({
    title: listing.title,
    description: metaDescription(listing.description, `${listing.title} on the ${STUDIO.shortName} Marketplace.`),
    path: `/marketplace/${encodeURIComponent(listing.slug ?? slug)}`,
    imageUrl: listing.thumbnail_url ?? undefined,
  });
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();
  return <ListingDetailView listing={listing} />;
}
