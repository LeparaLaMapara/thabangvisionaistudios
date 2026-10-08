export const revalidate = 60;

import { STUDIO } from '@/lib/constants';
import { getPublishedListings } from '@/lib/supabase/queries/marketplace';
import MarketplaceClient from './MarketplaceClient';

export const metadata = {
  title: 'Marketplace',
  description: `Creative gear and services supplied by ID-checked creators through ${STUDIO.shortName}. Enquire about an item and we confirm availability and price with you.`,
};

export default async function MarketplacePage() {
  const listings = await getPublishedListings();
  return <MarketplaceClient listings={listings} />;
}
