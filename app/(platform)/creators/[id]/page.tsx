import { notFound } from 'next/navigation';
import { getProfileById, getVerifiedProfiles } from '@/lib/supabase/queries/profiles';
import { getPublishedProductions } from '@/lib/supabase/queries/smartProductions';
import { getPublishedListings } from '@/lib/supabase/queries/marketplace';
import { getReviewsForUser } from '@/lib/supabase/queries/creatorReviews';
import CreatorProfileClient from './CreatorProfileClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfileById(id);
  return {
    title: profile?.display_name ?? 'Creator Profile',
  };
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CreatorProfilePage({ params }: Props) {
  const { id } = await params;
  const profile = await getProfileById(id);

  if (!profile) notFound();

  // Fetch creator's productions, listings, and reviews in parallel
  const [allProductions, allListings, reviews] = await Promise.all([
    getPublishedProductions(),
    getPublishedListings(),
    getReviewsForUser(id),
  ]);

  // Filter to this creator's content
  // Note: productions don't have user_id, so we show all for now
  // Listings have user_id which we can filter on
  const creatorListings = allListings.filter(
    (l) => 'user_id' in l && l.user_id === id,
  );

  return (
    <CreatorProfileClient
      profile={profile}
      productions={allProductions.slice(0, 6)}
      listings={creatorListings.slice(0, 4)}
      reviews={reviews}
    />
  );
}

export async function generateStaticParams() {
  const profiles = await getVerifiedProfiles();
  return profiles.map((p) => ({ id: p.id }));
}
