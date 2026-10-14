import { ROLES_POLICY } from '@/lib/constants';

/**
 * Nobody types twice. What the profile maker can take from an existing
 * account (Pure; the backfill script scripts/roles/backfill-existing.sql
 * does the same in SQL for accounts that exist today).
 */

export interface ProfileForPrefill {
  bio?: string | null;
  crew_bio?: string | null;
  location?: string | null;
  city?: string | null;
  specializations?: unknown;
  portfolio_projects?: unknown;
}

export interface MakerPrefill {
  headline: string;
  area: string;
  about: string;
}

const clip = (s: string | null | undefined, max: number): string => (s ?? '').replace(/[<>]/g, '').trim().slice(0, max);

export function profilePrefill(p: ProfileForPrefill | null | undefined): MakerPrefill {
  if (!p) return { headline: '', area: '', about: '' };
  const specs = Array.isArray(p.specializations) ? p.specializations.filter((s): s is string => typeof s === 'string') : [];
  const headline = specs.length ? specs.slice(0, 3).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ') : '';
  return {
    headline: clip(headline, 80),
    area: clip(p.location || p.city, 80),
    about: clip(p.crew_bio || p.bio, 600),
  };
}

export interface PortfolioEvidenceRow {
  person_role_id: string;
  step_key: string;
  kind: 'photo';
  source: 'uploaded';
  storage_provider: 'cloudinary';
  storage_ref: string;
  url: string;
}

/**
 * Photos already in the old creator portfolio become evidence for the
 * photographer role, marked "uploaded" (they were not taken in the app).
 * Only https URLs, no duplicates, at most ROLES_POLICY.maxFilesPerStep.
 */
export function portfolioEvidenceRows(personRoleId: string, portfolio: unknown, stepKey = 'best_work'): PortfolioEvidenceRow[] {
  if (!Array.isArray(portfolio)) return [];
  const seen = new Set<string>();
  const out: PortfolioEvidenceRow[] = [];
  for (const project of portfolio) {
    const photos = project && typeof project === 'object' ? (project as { photos?: unknown }).photos : null;
    if (!Array.isArray(photos)) continue;
    for (const ph of photos) {
      const url = ph && typeof ph === 'object' ? (ph as { url?: unknown }).url : null;
      const publicId = ph && typeof ph === 'object' ? (ph as { public_id?: unknown }).public_id : null;
      if (typeof url !== 'string' || !url.startsWith('https://') || url.length > 600 || seen.has(url)) continue;
      seen.add(url);
      out.push({
        person_role_id: personRoleId,
        step_key: stepKey,
        kind: 'photo',
        source: 'uploaded',
        storage_provider: 'cloudinary',
        storage_ref: typeof publicId === 'string' ? publicId.slice(0, 400) : url.slice(0, 400),
        url,
      });
      if (out.length >= ROLES_POLICY.maxFilesPerStep) return out;
    }
  }
  return out;
}

/** The role an old creator account maps to: the creator flow was photo and video. */
export const CREATOR_FLOW_ROLE = 'photographer-videographer';
