/**
 * Customer engagement (lifecycle emails and push). Shared shapes.
 *
 * Three stages, one message per person per step:
 *   welcome   the hello after joining (service message)
 *   nudge     "finish your signup", tailored to where they stopped (service)
 *   tailored  once the profile is complete, an AI-written note with concrete
 *             next steps (service, not marketing: owner decision 2026-10-13.
 *             Engagement is following through with the person; marketing,
 *             like news about features, is separate and needs marketing_opt_in)
 * Plus 'engage_push': a push copy of a notification bell item.
 */

export type Intent = 'rent' | 'hire' | 'list' | 'supply' | 'browse' | null;

export type Stage = 'welcome' | 'nudge' | 'tailored' | 'push';

export type EngageKind = 'engage_welcome' | 'engage_nudge' | 'engage_tailored' | 'engage_push';

export const STAGE_KIND: Record<Stage, EngageKind> = {
  welcome: 'engage_welcome',
  nudge: 'engage_nudge',
  tailored: 'engage_tailored',
  push: 'engage_push',
};

export type OnboardingStep = 1 | 2 | 3 | 4;

/** Where someone stopped. Each reason has its own email. */
export type NudgeReason =
  | 'cart'
  | 'listing_draft'
  | 'onboarding_step_1'
  | 'onboarding_step_2'
  | 'onboarding_step_3'
  | 'onboarding_step_4'
  | 'id_rejected'
  | 'id_not_started'
  | 'intent_only';

export type Verification = 'none' | 'pending' | 'verified' | 'rejected';

/** Everything the rules look at for one person. Counts and dates, no free text. */
export interface PersonFacts {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  createdAt: string;
  firstName: string | null;
  intent: Intent;
  suspended: boolean;
  optedOut: boolean;
  marketingOptIn: boolean;
  verification: Verification;
  /** When staff last decided the ID check (for a rejection). */
  verificationDecidedAt: string | null;
  /** Creator onboarding: the last step FINISHED (0 = none), from onboarding_progress. */
  onboarding: { finishedStep: number; updatedAt: string | null; completedAt: string | null } | null;
  /** profiles.onboarding_completed_at */
  onboardingCompletedAt: string | null;
  cart: { items: number; newestAt: string | null };
  draftListings: { count: number; latestAt: string | null };
  publishedListings: number;
  /** Gear and creator bookings made as a customer. */
  bookingsAsClient: number;
  welcome: { status: 'draft' | 'sending' | 'sent' | 'discarded' } | null;
  hasPush: boolean;
}

/** One engagement row already in the outbox for this person. */
export interface HistoryRow {
  dedupeKey: string;
  kind: string;
  channel: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
}

export interface MessageData {
  stage: Stage;
  reason?: NudgeReason;
  /** 1 or 2: which nudge for this reason. */
  nudge?: number;
  /** Filled after sending, for the admin log. */
  subject?: string;
  notificationId?: string;
}

export interface PlannedMessage {
  dedupeKey: string;
  kind: EngageKind;
  channel: 'email' | 'push';
  userId: string;
  data: MessageData;
}

/** Why nobody is emailed. */
export type BlockReason = 'no_email' | 'unconfirmed' | 'internal' | 'suspended' | 'opted_out';

export interface Plan {
  messages: PlannedMessage[];
  /** Set when the person gets nothing this run, and why. */
  held?: BlockReason | 'daily_cap' | 'weekly_cap' | 'nothing_due';
}
