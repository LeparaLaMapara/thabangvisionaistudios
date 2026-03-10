export const revalidate = 60;

import { getPublishedListings } from '@/lib/supabase/queries/marketplace';
import MarketplaceClient from './MarketplaceClient';

export const metadata = {
  title: 'Marketplace',
  description: 'Buy, sell, and rent creative gear and services from verified South African creators.',
};

export default async function MarketplacePage() {
  const listings = await getPublishedListings();
  return <MarketplaceClient listings={listings} />;
}
