export const revalidate = 60;

import { notFound } from 'next/navigation';
import { getPublicProfileById } from '@/lib/supabase/queries/profiles';
import { getProductionsByCreator } from '@/lib/supabase/queries/smartProductions';
import { getRentalsByOwner } from '@/lib/supabase/queries/smartRentals';
import { getPublishedListings } from '@/lib/supabase/queries/marketplace';
import { getReviewsForUser } from '@/lib/supabase/queries/creatorReviews';
import CreatorProfileClient from './CreatorProfileClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getPublicProfileById(id);
  return {
    title: profile?.display_name ?? 'Creator Profile',
  };
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CreatorProfilePage({ params }: Props) {
  const { id } = await params;
  const profile = await getPublicProfileById(id);

  if (!profile) notFound();

  // Everything this person has, fetched by their id rather than filtered in
  // memory. Productions used to be fetched unfiltered and sliced to six on the
  // basis that they had no owner column; they do (`creator_id`), so every
  // profile was showing the same six projects — other people's work presented
  // as this person's portfolio.
  const [productions, rentals, allListings, reviews] = await Promise.all([
    getProductionsByCreator(id),
    getRentalsByOwner(id),
    getPublishedListings(),
    getReviewsForUser(id),
  ]);

  // Marketplace listings are still filtered in memory: there is no by-user
  // query for them yet, and the table holds a single row.
  const creatorListings = allListings.filter(
    (l) => 'user_id' in l && l.user_id === id,
  );

  return (
    <CreatorProfileClient
      profile={profile}
      productions={productions}
      rentals={rentals}
      listings={creatorListings.slice(0, 4)}
      reviews={reviews}
    />
  );
}
