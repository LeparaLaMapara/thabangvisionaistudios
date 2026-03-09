import { getPublishedRentalsByCategory, getCommunityListingsByCategory } from '@/lib/supabase/queries/smartRentals';
import RentalCategoryClient from './RentalCategoryClient';

export const revalidate = 60;

export default async function RentalCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const [rentals, communityListings] = await Promise.all([
    getPublishedRentalsByCategory(category),
    getCommunityListingsByCategory(category),
  ]);
  const tagged = rentals.map(r => ({ ...r, source: r.source ?? 'studio' as const }));
  return <RentalCategoryClient rentals={[...tagged, ...communityListings]} category={category} />;
}
