export const revalidate = 60;

import { STUDIO } from '@/lib/constants';
import { getPublishedListings } from '@/lib/supabase/queries/marketplace';
import MarketplaceClient from './MarketplaceClient';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const metadata = buildPageMetadata({
  title: 'Marketplace',
  description: `Creative gear and services supplied by ID-checked creators through ${STUDIO.shortName}. Enquire about an item and we confirm availability and price with you.`,
  path: '/marketplace',
});

export default async function MarketplacePage() {
  const listings = await getPublishedListings();
  return <MarketplaceClient listings={listings} />;
}
