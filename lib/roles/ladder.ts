import { ROLES_POLICY, STUDIO } from '@/lib/constants';
import { EVIDENCE_LEVELS, type EvidenceKind, type EvidenceLevel, type EvidenceSource } from './types';

/**
 * The evidence ladder (docs/processes/roles-and-proof.md). Pure.
 *
 *   new      identity checked
 *   shown    a proof task done in the app, accepted by a reviewer
 *   vouched  a past client or a proven pro confirmed (checked by a person)
 *   proven   3 confirmed ThabangVision jobs
 *   trusted  more jobs, good reviews, no disputes
 *
 * The level limits the size of a single job, like the renter trust tiers
 * (lib/core/rental/trust.ts). Nobody is blocked: a person is matched to the
 * work their record supports, and is told what unlocks the next level.
 * Clients never see the level, only "Verified" and a real job count.
 */

export interface EvidenceFact {
  kind: EvidenceKind;
  source: EvidenceSource;
  /** A reviewer (or the booking system) confirmed this item. */
  verified: boolean;
}

export interface LadderFacts {
  identityVerified: boolean;
  /** A reviewer approved the profile against the role's guidelines. */
  profileApproved: boolean;
  evidence: readonly EvidenceFact[];
  /** Completed ThabangVision jobs in this role, confirmed. */
  confirmedJobs: number;
  reviewCount: number;
  /** Average star rating, 0 when there are no reviews. */
  averageRating: number;
  /** Disputes ever raised against this person in this role, open or upheld. */
  disputes: number;
}

export interface LadderResult {
  level: EvidenceLevel;
  /** What would unlock the next level, in plain words. Empty at the top. */
  next: { level: EvidenceLevel; missing: string[] } | null;
}

const L = ROLES_POLICY.ladder;

const isWork = (e: EvidenceFact): boolean => e.kind === 'photo' || e.kind === 'video';

export function capturedWorkCount(evidence: readonly EvidenceFact[]): number {
  return evidence.filter((e) => isWork(e) && (e.source === 'captured_in_app' || e.source === 'assessed')).length;
}

export function confirmedVouches(evidence: readonly EvidenceFact[]): number {
  return evidence.filter((e) => e.kind === 'vouch' && e.verified).length;
}

/** Confirmed jobs: the larger of the booking count given and verified booking evidence. */
export function confirmedJobCount(evidence: readonly EvidenceFact[], bookings = 0): number {
  const fromEvidence = evidence.filter((e) => e.kind === 'booking' && e.verified).length;
  return Math.max(Math.max(0, Math.floor(bookings)), fromEvidence);
}

const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function evidenceLevel(f: LadderFacts): LadderResult {
  const jobs = Math.max(0, Math.floor(f.confirmedJobs));
  const captured = capturedWorkCount(f.evidence);
  const vouches = confirmedVouches(f.evidence);

  const shown = f.identityVerified && f.profileApproved && captured >= L.shownMinCaptured;
  const vouched = shown && vouches >= L.vouchedMinVouches;
  const proven = f.identityVerified && jobs >= L.provenMinJobs;
  const trusted =
    proven &&
    jobs >= L.trustedMinJobs &&
    f.reviewCount >= L.trustedMinReviews &&
    f.averageRating >= L.trustedMinAverageRating &&
    f.disputes === 0;

  if (trusted) return { level: 'trusted', next: null };

  if (proven) {
    const missing: string[] = [];
    if (jobs < L.trustedMinJobs) missing.push(`${plural(L.trustedMinJobs - jobs, 'more job')} done well`);
    if (f.reviewCount < L.trustedMinReviews) missing.push(`${plural(L.trustedMinReviews - f.reviewCount, 'more review')}`);
    if (f.reviewCount > 0 && f.averageRating < L.trustedMinAverageRating) missing.push(`an average of ${L.trustedMinAverageRating} stars or more`);
    if (f.disputes > 0) missing.push('no disputes');
    return { level: 'proven', next: { level: 'trusted', missing } };
  }

  const toProven = `${plural(L.provenMinJobs - jobs, 'job')} done on ${STUDIO.shortName}`;

  if (vouched) return { level: 'vouched', next: { level: 'proven', missing: [toProven] } };

  if (shown) {
    return {
      level: 'shown',
      next: { level: 'vouched', missing: ['a past client or a proven pro to vouch for you'] },
    };
  }

  const missing: string[] = [];
  if (!f.identityVerified) missing.push('finish the ID and selfie check');
  if (captured < L.shownMinCaptured) missing.push(`${plural(L.shownMinCaptured - captured, 'photo or video', 'photos or videos')} taken in the app`);
  if (!f.profileApproved) missing.push('your profile approved by our team');
  return { level: 'new', next: { level: 'shown', missing } };
}

export function isEvidenceLevel(v: unknown): v is EvidenceLevel {
  return typeof v === 'string' && (EVIDENCE_LEVELS as readonly string[]).includes(v);
}

/** The biggest single job this level may take, in cents. */
export function jobSizeLimitCents(level: EvidenceLevel): number {
  return ROLES_POLICY.jobSizeLimitsCents[level];
}

export type JobFit =
  | { ok: true; limitCents: number }
  | { ok: false; limitCents: number; message: string };

const zar = (cents: number): string => `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;

/**
 * Whether a person at this level may take a job of this size. A "no" is
 * never a block on the person: it says what their record supports and how to
 * grow it, and the job can still go to someone with more history.
 */
export function canTakeJob(level: EvidenceLevel, jobCents: number, next?: LadderResult['next']): JobFit {
  const limitCents = jobSizeLimitCents(level);
  if (jobCents <= limitCents) return { ok: true, limitCents };
  const how = next && next.missing.length ? ` To take bigger jobs: ${next.missing.join('; ')}.` : '';
  return {
    ok: false,
    limitCents,
    message: `For now you can take jobs up to ${zar(limitCents)}. This one is ${zar(jobCents)}.${how}`,
  };
}
