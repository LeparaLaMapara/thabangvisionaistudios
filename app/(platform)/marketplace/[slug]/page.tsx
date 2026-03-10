import { notFound } from 'next/navigation';
import { getListingBySlug } from '@/lib/supabase/queries/marketplace';
import ListingDetailView from './ListingDetailView';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: 'Listing Not Found' };
  return {
    title: listing.title,
    description: listing.description ?? `${listing.title} on the Marketplace`,
  };
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
