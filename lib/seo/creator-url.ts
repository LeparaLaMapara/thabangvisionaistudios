import { PRODUCTION_CATEGORIES } from '@/lib/constants';
import { hasCompletePortfolio } from '@/lib/portfolio/validation';
import type { PortfolioProject } from '@/types/portfolio';

/**
 * One address per creator.
 *
 * A creator profile used to answer at /creators/<uuid>, at
 * /studio/category/<any category>/<slug> and at /studio/category/<any>/<uuid>,
 * and most links hard-coded the photography category. Search engines saw
 * several copies of one page. The canonical address is now
 *   /studio/category/<the creator's own category>/<crew_slug, else id>
 * and every other form redirects (308) to it.
 */

type CategoryLike = { slug: string; creatorKeywords: string[] };

/**
 * Whether a creator belongs in a category: one of their specialisations is
 * one of the category's creator keywords (case-insensitive). The same test the
 * category page runs in the database (`overlaps` on specializations).
 */
export function creatorMatchesCategory(
  specializations: string[] | null | undefined,
  category: CategoryLike,
): boolean {
  const mine = new Set((specializations ?? []).map((s) => s.toLowerCase()));
  return category.creatorKeywords.some((k) => mine.has(k.toLowerCase()));
}

/**
 * The creator's own category: the first production category that matches
 * their specialisations. A creator who has not chosen any falls back to the
 * first category, which is the general one (photography).
 */
export function creatorCategorySlug(
  specializations: string[] | null | undefined,
  categories: CategoryLike[] = PRODUCTION_CATEGORIES,
): string {
  const match = categories.find((c) => creatorMatchesCategory(specializations, c));
  return (match ?? categories[0]).slug;
}

/** The handle in the address: the crew slug when there is one, else the id. */
export function creatorHandle(creator: { id: string; crew_slug: string | null }): string {
  return creator.crew_slug || creator.id;
}

/** The canonical path of a creator profile. */
export function creatorProfilePath(creator: {
  id: string;
  crew_slug: string | null;
  specializations?: string[] | null;
}): string {
  return `/studio/category/${creatorCategorySlug(creator.specializations)}/${encodeURIComponent(creatorHandle(creator))}`;
}

/**
 * Whether a creator gets a public, bookable profile page: ID check passed,
 * open for work, and at least one complete portfolio project. The same rule
 * as getCrewBySlug in lib/supabase/queries/crew.ts.
 */
export function isListedCreator(p: {
  verification_status?: string | null;
  available_for_hire?: boolean | null;
  portfolio_projects?: PortfolioProject[] | null;
}): boolean {
  return (
    p.verification_status === 'verified' &&
    p.available_for_hire === true &&
    hasCompletePortfolio(p.portfolio_projects)
  );
}
