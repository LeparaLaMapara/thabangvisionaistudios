export const revalidate = 60;

import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getPublicProfileById } from '@/lib/supabase/queries/profiles';
import { getCrewBySlug } from '@/lib/supabase/queries/crew';
import { getProductionsByCreator } from '@/lib/supabase/queries/smartProductions';
import { getRentalsByOwner } from '@/lib/supabase/queries/smartRentals';
import { getPublishedListings } from '@/lib/supabase/queries/marketplace';
import { getReviewsForUser } from '@/lib/supabase/queries/creatorReviews';
import { STUDIO } from '@/lib/constants';
import { buildPageMetadata, metaDescription } from '@/lib/seo/metadata';
import { creatorProfilePath, isListedCreator } from '@/lib/seo/creator-url';
import type { PortfolioProject } from '@/types/portfolio';
import CreatorProfileClient from './CreatorProfileClient';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read once per request; generateMetadata and the page share it. */
const loadProfile = cache(async (id: string) => (UUID.test(id) ? getPublicProfileById(id) : null));
const loadRentals = cache((id: string) => getRentalsByOwner(id));

/**
 * Where this address should really go, or null to render it here.
 *
 * A bookable creator's profile lives at /studio/category/<category>/<slug>
 * (lib/seo/creator-url.ts); this address redirects there (308) so the person
 * has one page, not two. Some links used /creators/<crew slug>, which never
 * resolved (this page looked the slug up as an id): those redirect too.
 */
async function canonicalRedirect(id: string): Promise<string | null> {
  if (!UUID.test(id)) {
    const crew = await getCrewBySlug(id);
    return crew ? creatorProfilePath(crew) : null;
  }
  const profile = await loadProfile(id);
  if (
    profile &&
    isListedCreator({
      verification_status: profile.verification_status,
      available_for_hire: profile.available_for_hire,
      portfolio_projects: profile.portfolio_projects as PortfolioProject[] | null,
    })
  ) {
    return creatorProfilePath(profile);
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const profile = await loadProfile(id);
  if (!profile) return { title: 'Profile' };
  const name = profile.display_name ?? 'Creator';
  // A member who is not bookable is worth indexing only while they have gear
  // for hire; an empty profile is a thin page.
  const rentals = await loadRentals(id);
  return buildPageMetadata({
    title: name,
    description: metaDescription(
      profile.bio,
      `${name} on ${STUDIO.shortName}: gear for hire and work in ${profile.location ?? STUDIO.serviceArea.province}.`,
    ),
    path: `/creators/${profile.id}`,
    imageUrl: profile.avatar_url ?? undefined,
    noIndex: rentals.length === 0,
  });
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CreatorProfilePage({ params }: Props) {
  const { id } = await params;

  const target = await canonicalRedirect(id);
  if (target) permanentRedirect(target);

  const profile = await loadProfile(id);

  if (!profile) notFound();

  // Everything this person has, fetched by their id rather than filtered in
  // memory. Productions used to be fetched unfiltered and sliced to six on the
  // basis that they had no owner column; they do (`creator_id`), so every
  // profile was showing the same six projects — other people's work presented
  // as this person's portfolio.
  const [productions, rentals, allListings, reviews] = await Promise.all([
    getProductionsByCreator(id),
    loadRentals(id),
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
