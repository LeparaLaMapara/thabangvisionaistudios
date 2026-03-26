import type { PortfolioProject } from '@/types/portfolio';

/**
 * Checks if a creator has at least one complete portfolio project.
 * A complete project requires 3 photos. Video is optional.
 *
 * Used to gate:
 * - Crew services listing visibility
 * - Smart productions community listing visibility
 * - Available-for-hire toggle on profile page
 */
export function hasCompletePortfolio(
  portfolioProjects: PortfolioProject[] | null | undefined,
): boolean {
  if (!portfolioProjects || portfolioProjects.length === 0) return false;

  return portfolioProjects.some(
    (project) => project.photos.length >= 3,
  );
}
