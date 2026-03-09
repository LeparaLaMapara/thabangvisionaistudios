import { getPublishedRentals, getCommunityListings } from '@/lib/supabase/queries/smartRentals';
import SmartRentalsClient from './SmartRentalsClient';

export const revalidate = 60;

export default async function SmartRentalsPage() {
  const [rentals, communityListings] = await Promise.all([
    getPublishedRentals(),
    getCommunityListings(),
  ]);
  // Mark official rentals with source
  const tagged = rentals.map(r => ({ ...r, source: r.source ?? 'studio' as const }));
  return <SmartRentalsClient rentals={[...tagged, ...communityListings]} />;
}
