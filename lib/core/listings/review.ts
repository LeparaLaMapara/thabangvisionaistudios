/**
 * Community listing review rules (spec §8.1–8.2). Pure: no Supabase, Next.js
 * or provider imports. The server loads the facts, these functions decide.
 *
 * Journey: photo → AI suggests details and a rate (untrusted until the owner
 * confirms; lib/core/listings/suggest.ts) → owner reviews/corrects, enters
 * the replacement value and location → owner declarations at the submit
 * step → submit → a person reviews where required → published.
 *
 *            submit (review needed)            admin approve
 *   draft ─────────────────────► pending_review ───────────► published
 *     ▲ │ submit (established owner)  │  │ admin reject          │
 *     │ └────────────────────────────────┼──────────────────────►│
 *     │            owner withdraw ◄─────┘  ▼                     │
 *     │◄──────────────── owner unpublish ─────────────────────────┘
 *     │                            rejected ── owner resubmit ──► pending_review
 *     └── admin reinstate ── suspended ◄── admin (from any status)
 *
 * What is NOT checked by any of this: that the owner really owns the gear,
 * that it works, or that the replacement value is right. Those are the
 * owner's declarations. See docs/marketplace/listings.md.
 */

import { LISTING_POLICY } from '@/lib/constants';
import { toCents } from '@/lib/core/pricing/money';

// ── Statuses and transitions ────────────────────────────────────────────────

export const LISTING_STATUSES = ['draft', 'pending_review', 'published', 'rejected', 'suspended'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export type ListingActor = 'owner' | 'admin';

export function isListingStatus(value: unknown): value is ListingStatus {
  return typeof value === 'string' && (LISTING_STATUSES as readonly string[]).includes(value);
}

interface ListingTransitionRule {
  from: ListingStatus;
  to: ListingStatus;
  actors: readonly ListingActor[];
  reasonRequired?: boolean;
}

/**
 * Every allowed move. Anything not listed is refused. An owner reaches
 * `published` only through decideSubmission(), which checks whether a person
 * must review first; the table alone does not make that call.
 */
export const LISTING_TRANSITIONS: readonly ListingTransitionRule[] = [
  // Owner submits.
  { from: 'draft', to: 'pending_review', actors: ['owner'] },
  { from: 'draft', to: 'published', actors: ['owner'] },
  { from: 'rejected', to: 'pending_review', actors: ['owner'] },
  // Owner takes it back.
  { from: 'pending_review', to: 'draft', actors: ['owner'] },
  { from: 'published', to: 'draft', actors: ['owner'] },
  // A person reviews.
  { from: 'pending_review', to: 'published', actors: ['admin'] },
  { from: 'pending_review', to: 'rejected', actors: ['admin'], reasonRequired: true },
  // A person can take any listing down, and says why.
  { from: 'draft', to: 'suspended', actors: ['admin'], reasonRequired: true },
  { from: 'pending_review', to: 'suspended', actors: ['admin'], reasonRequired: true },
  { from: 'published', to: 'suspended', actors: ['admin'], reasonRequired: true },
  { from: 'rejected', to: 'suspended', actors: ['admin'], reasonRequired: true },
  // Reinstating returns it to the owner as a draft; it is reviewed again.
  { from: 'suspended', to: 'draft', actors: ['admin'] },
];

export type ListingTransitionCheck =
  | { ok: true; alreadyDone: boolean }
  | { ok: false; code: 'unknown_status' | 'not_allowed' | 'actor_not_allowed' | 'reason_required'; message: string };

export function checkListingTransition(
  from: unknown,
  to: ListingStatus,
  actor: ListingActor,
  reason?: string | null,
): ListingTransitionCheck {
  if (!isListingStatus(from)) {
    return { ok: false, code: 'unknown_status', message: `Unknown listing status: ${String(from)}` };
  }
  if (from === to) return { ok: true, alreadyDone: true };
  const rule = LISTING_TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!rule) {
    return { ok: false, code: 'not_allowed', message: `A listing cannot move from ${from} to ${to}.` };
  }
  if (!rule.actors.includes(actor)) {
    return { ok: false, code: 'actor_not_allowed', message: `Only ${rule.actors.join(' or ')} can move a listing from ${from} to ${to}.` };
  }
  if (rule.reasonRequired && !(reason && reason.trim())) {
    return { ok: false, code: 'reason_required', message: 'Give the owner a reason.' };
  }
  return { ok: true, alreadyDone: false };
}

// ── AI-suggested fields ─────────────────────────────────────────────────────

/** Fields the AI may fill in. Each stays untrusted until the owner confirms it. */
export const AI_SUGGESTIBLE_FIELDS = [
  'title',
  'description',
  'category',
  'brand',
  'model',
  'condition',
  'price_per_day',
  'price_per_week',
  'replacement_value',
  'rental_includes',
] as const;
export type AiSuggestibleField = (typeof AI_SUGGESTIBLE_FIELDS)[number];

export interface AiFieldEntry {
  status: 'suggested' | 'confirmed';
  suggested_at: string;
  confirmed_at?: string;
  /** 'owner_confirmed' (ticked as correct) or 'owner_edited' (changed it). */
  confirmed_by?: 'owner_confirmed' | 'owner_edited';
}
export type AiFields = Partial<Record<AiSuggestibleField, AiFieldEntry>>;

export function isAiSuggestibleField(value: unknown): value is AiSuggestibleField {
  return typeof value === 'string' && (AI_SUGGESTIBLE_FIELDS as readonly string[]).includes(value);
}

/** Reads the stored jsonb defensively: anything malformed is dropped. */
export function readAiFields(raw: unknown): AiFields {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: AiFields = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAiSuggestibleField(key) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (v.status !== 'suggested' && v.status !== 'confirmed') continue;
    out[key] = {
      status: v.status,
      suggested_at: typeof v.suggested_at === 'string' ? v.suggested_at : '',
      ...(typeof v.confirmed_at === 'string' && { confirmed_at: v.confirmed_at }),
      ...((v.confirmed_by === 'owner_confirmed' || v.confirmed_by === 'owner_edited') && { confirmed_by: v.confirmed_by }),
    };
  }
  return out;
}

export function unconfirmedAiFields(raw: unknown): AiSuggestibleField[] {
  const fields = readAiFields(raw);
  return AI_SUGGESTIBLE_FIELDS.filter((f) => fields[f]?.status === 'suggested');
}

/** Marks fields as AI-suggested (unconfirmed). A fresh suggestion replaces a confirmation. */
export function markAiSuggested(raw: unknown, fields: readonly unknown[], now: Date): AiFields {
  const out = readAiFields(raw);
  const at = now.toISOString();
  for (const f of fields) {
    if (isAiSuggestibleField(f)) out[f] = { status: 'suggested', suggested_at: at };
  }
  return out;
}

/** The owner confirms suggested fields as correct. Unknown or unsuggested fields are ignored. */
export function confirmAiFields(
  raw: unknown,
  fields: readonly unknown[],
  now: Date,
  how: 'owner_confirmed' | 'owner_edited' = 'owner_confirmed',
): AiFields {
  const out = readAiFields(raw);
  const at = now.toISOString();
  for (const f of fields) {
    if (!isAiSuggestibleField(f)) continue;
    const entry = out[f];
    if (entry?.status === 'suggested') {
      out[f] = { ...entry, status: 'confirmed', confirmed_at: at, confirmed_by: how };
    }
  }
  return out;
}

// ── Owner declarations ──────────────────────────────────────────────────────

export interface OwnerAttestations {
  /** I own this gear, or have lawful authority to rent it out. */
  owns_or_authorised: true;
  /** It is in the condition described and works. */
  condition_working: true;
  /** The location is where the gear is kept. */
  location_accurate: true;
  terms_version: string;
  accepted_at: string;
}

export const ATTESTATION_KEYS = ['owns_or_authorised', 'condition_working', 'location_accurate'] as const;
export type AttestationKey = (typeof ATTESTATION_KEYS)[number];

/**
 * Builds the stored declaration from what the owner ticked. All three must
 * be ticked; the terms version and time are set here, never by the browser.
 */
export function buildAttestations(
  input: unknown,
  now: Date,
  termsVersion: string = LISTING_POLICY.ownerTermsVersion,
): { ok: true; value: OwnerAttestations } | { ok: false; missing: AttestationKey[] } {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const missing = ATTESTATION_KEYS.filter((k) => src[k] !== true);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    value: {
      owns_or_authorised: true,
      condition_working: true,
      location_accurate: true,
      terms_version: termsVersion,
      accepted_at: now.toISOString(),
    },
  };
}

/** True when the stored declaration is complete and against the current terms. */
export function attestationsComplete(
  raw: unknown,
  termsVersion: string = LISTING_POLICY.ownerTermsVersion,
): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const a = raw as Record<string, unknown>;
  return (
    ATTESTATION_KEYS.every((k) => a[k] === true) &&
    a.terms_version === termsVersion &&
    typeof a.accepted_at === 'string' &&
    a.accepted_at.length > 0
  );
}

// ── Submission rules ────────────────────────────────────────────────────────

/** The listing, as the server read it from the database. Amounts in rands. */
export interface ListingForReview {
  listing_status: unknown;
  owner_type?: string | null;
  title: string | null;
  category: string | null;
  price_per_day: number | null;
  /** Rands. Optional: charged for whole weeks of a 7+ day hire when set. */
  price_per_week?: number | null;
  replacement_value: number | null;
  location: string | null;
  ai_fields: unknown;
  owner_attestations: unknown;
}

/** Facts about the owner, loaded by the server. Never from the browser. */
export interface ListingOwnerFacts {
  verificationStatus: string | null;
  /** banking_details.is_verified: a validated payout account. */
  payoutAccountVerified: boolean;
  isSuspended: boolean;
  /** Disputed hires of this owner's gear that are not closed. */
  openDisputes: number;
  /** The owner's OTHER listings that are live now. */
  publishedListings: number;
  /** The owner's listings currently rejected. */
  rejectedListings: number;
  /** The owner's listings currently suspended. */
  suspendedListings: number;
  /** Hires of this owner's gear, by someone other than the owner, that completed. */
  completedRentals: number;
}

export type SubmitBlockCode =
  | 'not_community'
  | 'wrong_status'
  | 'owner_not_verified'
  | 'payout_not_verified'
  | 'owner_suspended'
  | 'missing_title'
  | 'missing_category'
  | 'missing_price'
  | 'missing_replacement_value'
  | 'missing_location'
  | 'missing_attestations'
  | 'invalid_week_rate'
  | 'unconfirmed_ai_fields';

export interface SubmitBlock {
  code: SubmitBlockCode;
  message: string;
}

export type SubmitCheck = { ok: true } | { ok: false; reasons: SubmitBlock[] };

const SUBMITTABLE_FROM: readonly ListingStatus[] = ['draft', 'rejected'];

function positive(n: number | null | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

const DAYS_PER_WEEK = 7;

/**
 * Why a week rate cannot stand next to this day rate, or null when it can.
 * A hire of 7+ days is charged the week rate for each whole week
 * (lib/core/pricing/rental.ts hireCents), so a week rate above seven days at
 * the day rate would charge a renter more for booking a week than for seven
 * single days. No week rate (null) is always fine. Amounts in rands.
 */
export function weekRateProblem(dayRands: number | null | undefined, weekRands: number | null | undefined): string | null {
  if (weekRands === null || weekRands === undefined) return null;
  if (!positive(weekRands)) return 'Week rate must be an amount above zero.';
  if (!positive(dayRands)) return 'Set a day rate before a week rate.';
  if (toCents(weekRands) > DAYS_PER_WEEK * toCents(dayRands as number)) {
    return 'Week rate cannot be more than 7 days at the day rate. Lower the week rate or clear it.';
  }
  return null;
}

/** The owner-side conditions every publish needs, including an admin approval. */
export function ownerBlocks(owner: ListingOwnerFacts): SubmitBlock[] {
  const reasons: SubmitBlock[] = [];
  if (owner.verificationStatus !== 'verified') {
    reasons.push({ code: 'owner_not_verified', message: 'Finish your ID check first.' });
  }
  if (!owner.payoutAccountVerified) {
    reasons.push({ code: 'payout_not_verified', message: 'Add a bank account we have validated for payouts.' });
  }
  if (owner.isSuspended) {
    reasons.push({ code: 'owner_suspended', message: 'Your account is suspended. Contact support.' });
  }
  return reasons;
}

/** The listing-side conditions: everything a renter relies on is filled in and owned by the owner. */
export function listingBlocks(listing: ListingForReview): SubmitBlock[] {
  const reasons: SubmitBlock[] = [];
  if (listing.owner_type != null && listing.owner_type !== 'community') {
    reasons.push({ code: 'not_community', message: 'Only community listings go through owner submission.' });
  }
  if (!listing.title || !listing.title.trim()) reasons.push({ code: 'missing_title', message: 'Add a title.' });
  if (!listing.category || !listing.category.trim()) reasons.push({ code: 'missing_category', message: 'Choose a category.' });
  if (!positive(listing.price_per_day)) reasons.push({ code: 'missing_price', message: 'Set a day rate above zero.' });
  const weekProblem = positive(listing.price_per_day) ? weekRateProblem(listing.price_per_day, listing.price_per_week) : null;
  if (weekProblem) reasons.push({ code: 'invalid_week_rate', message: weekProblem });
  if (!positive(listing.replacement_value)) {
    reasons.push({ code: 'missing_replacement_value', message: 'Set what it would cost to replace this item.' });
  }
  if (!listing.location || !listing.location.trim()) {
    reasons.push({ code: 'missing_location', message: 'Add the suburb and city where the gear is kept.' });
  }
  if (!attestationsComplete(listing.owner_attestations)) {
    reasons.push({ code: 'missing_attestations', message: 'Confirm the three owner declarations.' });
  }
  const unconfirmed = unconfirmedAiFields(listing.ai_fields);
  if (unconfirmed.length > 0) {
    reasons.push({
      code: 'unconfirmed_ai_fields',
      message: `Check and confirm the AI-suggested ${unconfirmed.map((f) => f.replace(/_/g, ' ')).join(', ')}.`,
    });
  }
  return reasons;
}

/**
 * Whether the owner may submit this listing now. Requires a verified owner,
 * a validated payout account, every required field, the owner declarations
 * and no unconfirmed AI suggestion.
 */
export function canSubmit(listing: ListingForReview, owner: ListingOwnerFacts): SubmitCheck {
  const reasons: SubmitBlock[] = [];
  if (!isListingStatus(listing.listing_status) || !SUBMITTABLE_FROM.includes(listing.listing_status)) {
    reasons.push({
      code: 'wrong_status',
      message: `A listing that is ${String(listing.listing_status).replace(/_/g, ' ')} cannot be submitted.`,
    });
  }
  reasons.push(...ownerBlocks(owner), ...listingBlocks(listing));
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export type ReviewReasonCode =
  | 'owner_not_verified'
  | 'first_listing'
  | 'high_value'
  | 'unknown_value'
  | 'open_disputes'
  | 'owner_suspended'
  | 'previous_rejection'
  | 'suspended_listing'
  | 'resubmission'
  | 'not_established';

export interface ReviewReason {
  code: ReviewReasonCode;
  message: string;
}

export interface ReviewDecision {
  required: boolean;
  reasons: ReviewReason[];
}

/**
 * Whether a person must review this listing before it goes live. True unless
 * the owner is established and the listing is unremarkable. Fails closed:
 * any missing fact means a review.
 */
export function needsAdminReview(owner: ListingOwnerFacts, listing: ListingForReview): ReviewDecision {
  const policy = LISTING_POLICY;
  const reasons: ReviewReason[] = [];

  if (owner.verificationStatus !== 'verified') {
    reasons.push({ code: 'owner_not_verified', message: 'Owner ID check is not complete.' });
  }
  if (owner.publishedListings <= 0) {
    reasons.push({ code: 'first_listing', message: "Owner's first live listing." });
  }
  if (!positive(listing.replacement_value)) {
    reasons.push({ code: 'unknown_value', message: 'No replacement value.' });
  } else if (toCents(listing.replacement_value as number) > policy.reviewValueThresholdCents) {
    reasons.push({ code: 'high_value', message: 'Replacement value is above the review threshold.' });
  }
  if (owner.openDisputes > 0) {
    reasons.push({ code: 'open_disputes', message: 'Owner has an open dispute.' });
  }
  if (owner.isSuspended) {
    reasons.push({ code: 'owner_suspended', message: 'Owner account is suspended.' });
  }
  if (owner.rejectedListings > 0) {
    reasons.push({ code: 'previous_rejection', message: 'Owner has a rejected listing.' });
  }
  if (owner.suspendedListings > 0) {
    reasons.push({ code: 'suspended_listing', message: 'Owner has a suspended listing.' });
  }
  if (listing.listing_status === 'rejected') {
    reasons.push({ code: 'resubmission', message: 'Resubmitted after a rejection.' });
  }
  if (
    owner.publishedListings < policy.establishedOwner.minPublishedListings ||
    owner.completedRentals < policy.establishedOwner.minCompletedRentals
  ) {
    reasons.push({
      code: 'not_established',
      message: `Owner has ${owner.publishedListings} live listing(s) and ${owner.completedRentals} completed hire(s); ` +
        `${policy.establishedOwner.minPublishedListings} and ${policy.establishedOwner.minCompletedRentals} are needed to skip review.`,
    });
  }
  return { required: reasons.length > 0, reasons };
}

export type SubmissionDecision =
  | { ok: true; to: 'pending_review' | 'published'; review: ReviewDecision }
  | { ok: false; reasons: SubmitBlock[] };

/**
 * What submitting does: blocked (with reasons), sent to a person, or
 * published straight away for an established owner. An owner who is not
 * verified is never published automatically.
 */
export function decideSubmission(listing: ListingForReview, owner: ListingOwnerFacts): SubmissionDecision {
  const check = canSubmit(listing, owner);
  if (!check.ok) return check;
  const review = needsAdminReview(owner, listing);
  const autoPublish = !review.required && owner.verificationStatus === 'verified' && owner.payoutAccountVerified;
  const to = autoPublish ? 'published' : 'pending_review';
  const transition = checkListingTransition(listing.listing_status, to, 'owner');
  if (!transition.ok) {
    return { ok: false, reasons: [{ code: 'wrong_status', message: transition.message }] };
  }
  return { ok: true, to, review };
}

/** What submitting would say now, for the owner to see before pressing Submit. */
export interface SubmissionPrecheck {
  canSubmit: boolean;
  /** The listing's status does not allow a submission (e.g. it is live). */
  statusBlock: SubmitBlock | null;
  /** ID check, payout account, suspension: about the owner, not this listing. */
  ownerBlocks: SubmitBlock[];
  /** Fields, declarations and AI suggestions on this listing. */
  listingBlocks: SubmitBlock[];
  /** Whether a person will review it before it goes live, and why. */
  review: ReviewDecision;
  /** What a submission now would do, or null while something blocks it. */
  outcome: 'pending_review' | 'published' | null;
}

/**
 * The submit decision, split up for display. Same rules as
 * decideSubmission (it is what decides `canSubmit` and `outcome`); nothing is
 * relaxed. Read-only.
 */
export function precheckSubmission(listing: ListingForReview, owner: ListingOwnerFacts): SubmissionPrecheck {
  const decision = decideSubmission(listing, owner);
  const submittable = isListingStatus(listing.listing_status) && SUBMITTABLE_FROM.includes(listing.listing_status);
  return {
    canSubmit: decision.ok,
    statusBlock: submittable
      ? null
      : {
          code: 'wrong_status',
          message: `A listing that is ${String(listing.listing_status).replace(/_/g, ' ')} cannot be submitted.`,
        },
    ownerBlocks: ownerBlocks(owner),
    listingBlocks: listingBlocks(listing),
    review: needsAdminReview(owner, listing),
    outcome: decision.ok ? decision.to : null,
  };
}

/**
 * True when the owner has done everything on the listing itself: every
 * required field, the declarations and every AI suggestion checked. (The
 * owner-side checks, ID and payout account, are not part of it.) Used for
 * the `listing_draft_complete` funnel stage.
 */
export function listingFieldsComplete(listing: ListingForReview): boolean {
  return listingBlocks(listing).length === 0;
}

// ── Disputes ────────────────────────────────────────────────────────────────

/** `disputes.status` values that mean the dispute is not closed. */
export const OPEN_DISPUTE_STATUSES = ['open', 'investigating', 'escalated'] as const;

/**
 * Open disputes against an owner's gear: hires whose status is `disputed`,
 * plus hires with an open row in the `disputes` table. A hire counted by
 * both is counted once.
 */
export function countOpenDisputes(
  disputedBookingIds: readonly string[],
  openDisputeBookingIds: readonly (string | null)[],
): number {
  const ids = new Set<string>(disputedBookingIds);
  for (const id of openDisputeBookingIds) if (id) ids.add(id);
  return ids.size;
}

// ── Generic admin edits (/admin/rentals) ────────────────────────────────────

/**
 * The generic rental editor must not publish, unpublish or re-status a
 * community listing: that goes through review (/admin/listings), which
 * re-checks the owner and records who decided. Returns the refusal message,
 * or null when the edit is fine (studio rows, or a community edit that
 * leaves is_published as it is).
 */
export function adminRentalEditConflict(
  row: { owner_type: string | null; is_published: boolean | null },
  updates: Record<string, unknown>,
): string | null {
  if ((row.owner_type ?? 'studio') !== 'community') return null;
  const touchesStatus = 'listing_status' in updates;
  const flipsPublic =
    'is_published' in updates && updates.is_published !== undefined && Boolean(updates.is_published) !== Boolean(row.is_published);
  if (!touchesStatus && !flipsPublic) return null;
  return 'This is a community listing. Publish, reject or take it down in Listing review (/admin/listings), which re-checks the owner and records the decision.';
}

// ── Edits ───────────────────────────────────────────────────────────────────

/**
 * Changing any of these on a live or queued listing takes it back to draft:
 * what a reviewer (or the auto-publish rule) looked at is no longer what a
 * renter would see. The cover photo (thumbnail_url) is what search results
 * and cards show, so it counts like the gallery. Day rate and description
 * edits keep it live.
 */
export const MATERIAL_FIELDS = [
  'title',
  'category',
  'condition',
  'brand',
  'model',
  'price_per_week',
  'replacement_value',
  'rental_includes',
  'serial_number',
  'location',
  'gallery',
  'thumbnail_url',
] as const;

export function editNeedsResubmission(status: unknown, changedFields: readonly string[]): boolean {
  if (status === 'pending_review') return changedFields.length > 0;
  if (status !== 'published') return false;
  return changedFields.some((f) => (MATERIAL_FIELDS as readonly string[]).includes(f));
}
