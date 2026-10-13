/**
 * What the dashboard home shows a creator. Pure, so it is tested.
 */

/**
 * Service booking statuses that are a real job for the creator. 'pending' is
 * a client who has not paid yet: not a job, and the creator is not told about
 * it. pending_reassignment has no creator any more.
 */
export const CREATOR_JOB_STATUSES = [
  'paid',
  'accepted',
  'delivered',
  'disputed',
  'completed',
  'paid_out',
  'cancelled',
  'declined',
] as const;

/** Jobs that are not finished: what the creator still has to do something about. */
export const CREATOR_OPEN_JOB_STATUSES = ['paid', 'accepted', 'delivered', 'disputed'] as const;

export function isCreatorJobStatus(status: string | null | undefined): boolean {
  return (CREATOR_JOB_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * Whether the "What makes you bookable" checklist belongs on the home page:
 * anyone who said they came to offer their services, finished (or started
 * and finished) creator onboarding, has jobs, or is already available for
 * hire. A renter-only account does not see it.
 */
export function showsCreatorChecklist(f: {
  intent: unknown;
  onboardingCompletedAt: string | null | undefined;
  creatorJobs: number;
  availableForHire: boolean | null | undefined;
}): boolean {
  return (
    f.intent === 'supply' ||
    Boolean(f.onboardingCompletedAt) ||
    f.creatorJobs > 0 ||
    Boolean(f.availableForHire)
  );
}
