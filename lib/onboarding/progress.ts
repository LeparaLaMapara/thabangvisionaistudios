/**
 * Creator onboarding progress, kept pure so it is tested.
 *
 * The flow has 4 steps (Portfolio, Skills, Bio and Review, Gear).
 * onboarding_progress.current_step holds the last step the creator FINISHED
 * (saveProgress(N) runs when step N is done). The old resume code pushed that
 * number through a table from an earlier 6-step flow, so finishing step 1 or 2
 * both resumed at step 1, and a reload on step 3 went back to the start.
 */

export const ONBOARDING_TOTAL_STEPS = 4;

export interface SavedOnboardingProgress {
  current_step?: number | null;
  completed_at?: string | null;
}

/** The step to show when a creator comes back: the one after the last one they finished. */
export function resumeStep(
  progress: SavedOnboardingProgress | null | undefined,
  total: number = ONBOARDING_TOTAL_STEPS,
): number {
  const finished = Number(progress?.current_step ?? 0);
  if (!Number.isFinite(finished) || finished < 1) return 1;
  return Math.min(Math.floor(finished) + 1, total);
}

/**
 * Where a creator goes once onboarding is saved: the ID check, unless it has
 * already passed or is being checked. `from=onboarding` lets the ID page show
 * the next creator steps instead of "Back to your booking".
 */
export function onboardingNextPath(params: {
  verificationStatus: string | null | undefined;
  draftedGear?: number;
}): string {
  const status = params.verificationStatus ?? 'unverified';
  if (status === 'verified') return '/dashboard';
  const drafted = Math.max(0, Math.floor(params.draftedGear ?? 0));
  const query = new URLSearchParams({ from: 'onboarding' });
  if (drafted > 0) query.set('drafted', String(drafted));
  return `/dashboard/verification?${query.toString()}`;
}
