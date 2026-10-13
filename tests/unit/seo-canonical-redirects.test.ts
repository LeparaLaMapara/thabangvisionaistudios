/**
 * One address per page: duplicates redirect (308) to the canonical URL.
 *   - a rental under the wrong category -> its own category;
 *   - /catalog/<slug> -> the rental address;
 *   - a creator under the wrong category, or by id -> /studio/category/<their category>/<slug>;
 *   - /creators/<slug or id of a bookable creator> -> the same.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirects: string[] = [];
vi.mock('next/navigation', () => ({
  permanentRedirect: (url: string) => {
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT:308:${url}`);
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:307:${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const CREATOR_ID = '00000000-0000-4000-8000-0000000000aa';
const crew = {
  id: CREATOR_ID,
  display_name: 'Lebo',
  crew_slug: 'lebo',
  avatar_url: null,
  crew_bio: 'Music videos and short films.',
  bio: null,
  specializations: ['Cinematography'],
  hourly_rate: 500,
  location: 'Johannesburg',
  years_experience: 4,
  crew_featured: false,
  skills: null,
  social_links: null,
  portfolio_projects: [{ id: 'p', title: 't', photos: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] }],
};

vi.mock('@/lib/supabase/queries/crew', () => ({
  getCrewBySlug: async (h: string) => (h === 'lebo' || h === CREATOR_ID ? crew : null),
  getCrewPortfolio: async () => [],
  getCrewReviews: async () => [],
}));
vi.mock('@/lib/supabase/queries/smartProductions', () => ({
  getProductionsByType: async () => [],
  getProductionsByCreator: async () => [],
}));
vi.mock('@/lib/supabase/queries/profiles', () => ({
  getPublicProfileById: async (id: string) =>
    id === CREATOR_ID ? { ...crew, available_for_hire: true, verification_status: 'verified', is_verified: true, created_at: '' } : null,
}));
const rental = {
  id: 'r1',
  slug: 'canon-r6ii',
  title: 'Canon R6 II',
  category: 'cameras-optics',
  description: 'Body.',
  price_per_day: 1400,
  thumbnail_url: null,
  gallery: null,
  is_available: true,
  brand: 'Canon',
  model: null,
  average_rating: 0,
  review_count: 0,
  owner_type: 'studio',
  owner_id: null,
};
vi.mock('@/lib/supabase/queries/smartRentals', () => ({
  getRentalBySlug: async (slug: string) => (slug === rental.slug ? rental : null),
  getRelatedRentals: async () => [],
  getRentalOwner: async () => null,
  getRentalsByOwner: async () => [],
}));
vi.mock('@/lib/supabase/queries/marketplace', () => ({ getPublishedListings: async () => [] }));
vi.mock('@/lib/supabase/queries/creatorReviews', () => ({ getReviewsForUser: async () => [] }));
vi.mock('@/lib/payments/status', () => ({ onlinePaymentsOpen: () => false }));
vi.mock('@/app/(platform)/rentals/[category]/[slug]/RentalDetailView', () => ({ default: () => null }));
vi.mock('@/app/(platform)/studio/category/[slug]/[id]/ProductionCreatorDetailView', () => ({ default: () => null }));
vi.mock('@/app/(platform)/studio/category/[slug]/[id]/ProductionPackageDetailView', () => ({ default: () => null }));
vi.mock('@/app/(platform)/creators/[id]/CreatorProfileClient', () => ({ default: () => null }));
vi.mock('@/components/ubunye/AskUbunyeButton', () => ({ AskUbunyeButton: () => null }));

import RentalDetailPage from '@/app/(platform)/rentals/[category]/[slug]/page';
import CatalogDetailPage from '@/app/(platform)/catalog/[slug]/page';
import CreatorStudioPage from '@/app/(platform)/studio/category/[slug]/[id]/page';
import CreatorProfilePage from '@/app/(platform)/creators/[id]/page';

const CANON = '/studio/category/video-production/lebo';

beforeEach(() => {
  redirects.length = 0;
});

describe('rental addresses', () => {
  it('redirects a rental under the wrong category to its own', async () => {
    await expect(
      RentalDetailPage({ params: Promise.resolve({ category: 'audio', slug: 'canon-r6ii' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual(['/rentals/cameras-optics/canon-r6ii']);
  });

  it('renders the rental at its own address', async () => {
    await expect(
      RentalDetailPage({ params: Promise.resolve({ category: 'cameras-optics', slug: 'canon-r6ii' }) }),
    ).resolves.toBeTruthy();
    expect(redirects).toEqual([]);
  });

  it('redirects /catalog/<slug> to the rental address, and 404s an unknown slug', async () => {
    await expect(CatalogDetailPage({ params: Promise.resolve({ slug: 'canon-r6ii' }) })).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual(['/rentals/cameras-optics/canon-r6ii']);
    await expect(CatalogDetailPage({ params: Promise.resolve({ slug: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('creator addresses', () => {
  it('redirects a creator under the wrong category to their own', async () => {
    await expect(
      CreatorStudioPage({ params: Promise.resolve({ slug: 'photography', id: 'lebo' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual([CANON]);
  });

  it('redirects the id form to the slug form', async () => {
    await expect(
      CreatorStudioPage({ params: Promise.resolve({ slug: 'video-production', id: CREATOR_ID }) }),
    ).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual([CANON]);
  });

  it('renders at the canonical address', async () => {
    await expect(
      CreatorStudioPage({ params: Promise.resolve({ slug: 'video-production', id: 'lebo' }) }),
    ).resolves.toBeTruthy();
    expect(redirects).toEqual([]);
  });

  it('redirects /creators/<id> and /creators/<slug> of a bookable creator', async () => {
    await expect(CreatorProfilePage({ params: Promise.resolve({ id: CREATOR_ID }) })).rejects.toThrow('NEXT_REDIRECT:308');
    await expect(CreatorProfilePage({ params: Promise.resolve({ id: 'lebo' }) })).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual([CANON, CANON]);
  });

  it('404s an unknown /creators/<handle>', async () => {
    await expect(CreatorProfilePage({ params: Promise.resolve({ id: 'nobody' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
