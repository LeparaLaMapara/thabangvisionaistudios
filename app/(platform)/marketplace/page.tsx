export const revalidate = 60;

import { redirect } from 'next/navigation';
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
  // Nothing published: no empty catalogue page. Gear for hire is on /rentals
  // (temporary redirect; the page comes back by itself with the first listing,
  // and the marketplace sitemap lists nothing while it is empty).
  if (listings.length === 0) redirect('/rentals');
  return <MarketplaceClient listings={listings} />;
}
