import { describe, it, expect } from 'vitest';
import { LISTING_POLICY, RENTAL_POLICY } from '@/lib/constants';
import {
  attestationsComplete,
  buildAttestations,
  canSubmit,
  checkListingTransition,
  confirmAiFields,
  decideSubmission,
  editNeedsResubmission,
  LISTING_TRANSITIONS,
  markAiSuggested,
  needsAdminReview,
  readAiFields,
  unconfirmedAiFields,
  type ListingForReview,
  type ListingOwnerFacts,
} from '@/lib/core/listings/review';

const NOW = new Date('2026-10-09T10:00:00Z');

function attested(): unknown {
  const a = buildAttestations({ owns_or_authorised: true, condition_working: true, location_accurate: true }, NOW);
  if (!a.ok) throw new Error('fixture');
  return a.value;
}

function listing(over: Partial<ListingForReview> = {}): ListingForReview {
  return {
    listing_status: 'draft',
    owner_type: 'community',
    title: 'Sony A7 III',
    category: 'cameras-optics',
    price_per_day: 450,
    replacement_value: 25000,
    location: 'Braamfontein, Johannesburg',
    ai_fields: null,
    owner_attestations: attested(),
    ...over,
  };
}

function owner(over: Partial<ListingOwnerFacts> = {}): ListingOwnerFacts {
  return {
    verificationStatus: 'verified',
    payoutAccountVerified: true,
    isSuspended: false,
    openDisputes: 0,
    publishedListings: 0,
    rejectedListings: 0,
    suspendedListings: 0,
    completedRentals: 0,
    ...over,
  };
}

const ESTABLISHED: Partial<ListingOwnerFacts> = {
  publishedListings: LISTING_POLICY.establishedOwner.minPublishedListings,
  completedRentals: LISTING_POLICY.establishedOwner.minCompletedRentals,
};

function codes(r: ReturnType<typeof canSubmit>): string[] {
  return r.ok ? [] : r.reasons.map((x) => x.code);
}

describe('canSubmit', () => {
  it('accepts a complete listing from a verified owner with a validated payout account', () => {
    expect(canSubmit(listing(), owner())).toEqual({ ok: true });
  });

  it('requires a verified owner', () => {
    for (const status of ['unverified', 'pending', 'rejected', null]) {
      expect(codes(canSubmit(listing(), owner({ verificationStatus: status })))).toContain('owner_not_verified');
    }
  });

  it('requires a validated payout account, not just saved bank details', () => {
    expect(codes(canSubmit(listing(), owner({ payoutAccountVerified: false })))).toContain('payout_not_verified');
  });

  it('refuses a suspended owner', () => {
    expect(codes(canSubmit(listing(), owner({ isSuspended: true })))).toContain('owner_suspended');
  });

  it('requires every field a renter relies on', () => {
    const r = canSubmit(
      listing({ title: ' ', category: null, price_per_day: 0, replacement_value: null, location: '' }),
      owner(),
    );
    expect(codes(r)).toEqual(
      expect.arrayContaining(['missing_title', 'missing_category', 'missing_price', 'missing_replacement_value', 'missing_location']),
    );
  });

  it('refuses negative or non-finite amounts', () => {
    expect(codes(canSubmit(listing({ price_per_day: -5 }), owner()))).toContain('missing_price');
    expect(codes(canSubmit(listing({ replacement_value: Number.NaN }), owner()))).toContain('missing_replacement_value');
  });

  it('requires the owner declarations against the current terms', () => {
    expect(codes(canSubmit(listing({ owner_attestations: null }), owner()))).toContain('missing_attestations');
    const old = { ...(attested() as Record<string, unknown>), terms_version: '2000-01-01' };
    expect(codes(canSubmit(listing({ owner_attestations: old }), owner()))).toContain('missing_attestations');
    const partial = { ...(attested() as Record<string, unknown>), condition_working: false };
    expect(codes(canSubmit(listing({ owner_attestations: partial }), owner()))).toContain('missing_attestations');
  });

  it('refuses while any AI suggestion is unconfirmed, and names it', () => {
    const ai = markAiSuggested(null, ['title', 'price_per_day'], NOW);
    const r = canSubmit(listing({ ai_fields: ai }), owner());
    expect(codes(r)).toContain('unconfirmed_ai_fields');
    if (!r.ok) expect(r.reasons.find((x) => x.code === 'unconfirmed_ai_fields')?.message).toMatch(/title, price per day/);
    const confirmed = confirmAiFields(ai, ['title', 'price_per_day'], NOW);
    expect(canSubmit(listing({ ai_fields: confirmed }), owner())).toEqual({ ok: true });
  });

  it('only submits drafts and rejected listings', () => {
    expect(codes(canSubmit(listing({ listing_status: 'rejected' }), owner()))).toEqual([]);
    for (const s of ['pending_review', 'published', 'suspended', 'nonsense']) {
      expect(codes(canSubmit(listing({ listing_status: s }), owner()))).toContain('wrong_status');
    }
  });

  it('is only for community listings', () => {
    expect(codes(canSubmit(listing({ owner_type: 'studio' }), owner()))).toContain('not_community');
  });
});

describe('needsAdminReview', () => {
  it("always reviews an owner's first listing", () => {
    const r = needsAdminReview(owner(), listing());
    expect(r.required).toBe(true);
    expect(r.reasons.map((x) => x.code)).toContain('first_listing');
  });

  it('skips review only for an established owner with an ordinary listing', () => {
    expect(needsAdminReview(owner(ESTABLISHED), listing())).toEqual({ required: false, reasons: [] });
  });

  it('reviews above the value threshold', () => {
    const over = LISTING_POLICY.reviewValueThresholdCents / 100 + 1;
    const r = needsAdminReview(owner(ESTABLISHED), listing({ replacement_value: over }));
    expect(r.required).toBe(true);
    expect(r.reasons.map((x) => x.code)).toContain('high_value');
    const at = LISTING_POLICY.reviewValueThresholdCents / 100;
    expect(needsAdminReview(owner(ESTABLISHED), listing({ replacement_value: at })).required).toBe(false);
  });

  it('uses the high-value collection threshold by default', () => {
    expect(LISTING_POLICY.reviewValueThresholdCents).toBe(RENTAL_POLICY.highValueCollectionThresholdCents);
  });

  it('reviews owners with open disputes, suspension, rejections or suspended listings', () => {
    const cases: [Partial<ListingOwnerFacts>, string][] = [
      [{ openDisputes: 1 }, 'open_disputes'],
      [{ isSuspended: true }, 'owner_suspended'],
      [{ rejectedListings: 1 }, 'previous_rejection'],
      [{ suspendedListings: 1 }, 'suspended_listing'],
    ];
    for (const [facts, code] of cases) {
      const r = needsAdminReview(owner({ ...ESTABLISHED, ...facts }), listing());
      expect(r.required).toBe(true);
      expect(r.reasons.map((x) => x.code)).toContain(code);
    }
  });

  it('reviews until the owner has both enough live listings and enough completed hires', () => {
    const { minPublishedListings, minCompletedRentals } = LISTING_POLICY.establishedOwner;
    expect(needsAdminReview(owner({ publishedListings: minPublishedListings, completedRentals: minCompletedRentals - 1 }), listing()).required).toBe(true);
    expect(needsAdminReview(owner({ publishedListings: minPublishedListings - 1, completedRentals: minCompletedRentals }), listing()).required).toBe(true);
  });

  it('reviews a resubmission after rejection and a listing with no value', () => {
    expect(needsAdminReview(owner(ESTABLISHED), listing({ listing_status: 'rejected' })).required).toBe(true);
    expect(needsAdminReview(owner(ESTABLISHED), listing({ replacement_value: null })).required).toBe(true);
  });

  it('keeps the established bar conservative', () => {
    expect(LISTING_POLICY.establishedOwner.minPublishedListings).toBeGreaterThanOrEqual(3);
    expect(LISTING_POLICY.establishedOwner.minCompletedRentals).toBeGreaterThanOrEqual(3);
  });
});

describe('decideSubmission', () => {
  it('sends a first listing to a person', () => {
    const d = decideSubmission(listing(), owner());
    expect(d.ok && d.to).toBe('pending_review');
  });

  it('publishes straight away for an established owner', () => {
    const d = decideSubmission(listing(), owner(ESTABLISHED));
    expect(d.ok && d.to).toBe('published');
  });

  it('never publishes for an unverified owner, however established', () => {
    const d = decideSubmission(listing(), owner({ ...ESTABLISHED, verificationStatus: 'pending' }));
    expect(d.ok).toBe(false);
  });

  it('sends a rejected listing back to a person, never straight to live', () => {
    const d = decideSubmission(listing({ listing_status: 'rejected' }), owner(ESTABLISHED));
    expect(d.ok && d.to).toBe('pending_review');
  });

  it('returns every blocking reason at once', () => {
    const d = decideSubmission(listing({ title: '', owner_attestations: null }), owner({ payoutAccountVerified: false }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('listing status transitions', () => {
  it('lets the owner submit, withdraw and unpublish', () => {
    expect(checkListingTransition('draft', 'pending_review', 'owner').ok).toBe(true);
    expect(checkListingTransition('rejected', 'pending_review', 'owner').ok).toBe(true);
    expect(checkListingTransition('pending_review', 'draft', 'owner').ok).toBe(true);
    expect(checkListingTransition('published', 'draft', 'owner').ok).toBe(true);
  });

  it('does not let the owner approve, reject, suspend or reinstate', () => {
    expect(checkListingTransition('pending_review', 'published', 'owner')).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(checkListingTransition('pending_review', 'rejected', 'owner')).toMatchObject({ ok: false });
    expect(checkListingTransition('published', 'suspended', 'owner')).toMatchObject({ ok: false });
    expect(checkListingTransition('suspended', 'draft', 'owner')).toMatchObject({ ok: false });
    expect(checkListingTransition('rejected', 'published', 'owner')).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('lets an admin approve or reject a queued listing, with a reason to reject', () => {
    expect(checkListingTransition('pending_review', 'published', 'admin').ok).toBe(true);
    expect(checkListingTransition('pending_review', 'rejected', 'admin')).toMatchObject({ ok: false, code: 'reason_required' });
    expect(checkListingTransition('pending_review', 'rejected', 'admin', 'Photos are of a different lens').ok).toBe(true);
  });

  it('lets an admin suspend from any status (with a reason) and reinstate to draft', () => {
    for (const from of ['draft', 'pending_review', 'published', 'rejected'] as const) {
      expect(checkListingTransition(from, 'suspended', 'admin', 'Reported stolen').ok).toBe(true);
      expect(checkListingTransition(from, 'suspended', 'admin', '  ')).toMatchObject({ ok: false, code: 'reason_required' });
    }
    expect(checkListingTransition('suspended', 'draft', 'admin').ok).toBe(true);
    expect(checkListingTransition('suspended', 'published', 'admin')).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('does not let an admin approve a draft that was never submitted', () => {
    expect(checkListingTransition('draft', 'published', 'admin')).toMatchObject({ ok: false, code: 'actor_not_allowed' });
  });

  it('treats a repeat as already done and refuses unknown statuses', () => {
    expect(checkListingTransition('published', 'published', 'admin')).toEqual({ ok: true, alreadyDone: true });
    expect(checkListingTransition('live', 'published', 'admin')).toMatchObject({ ok: false, code: 'unknown_status' });
  });

  it('has no rule that lets anyone leave suspended except to draft', () => {
    expect(LISTING_TRANSITIONS.filter((t) => t.from === 'suspended').map((t) => t.to)).toEqual(['draft']);
  });
});

describe('AI-suggested fields', () => {
  it('marks, lists and confirms suggestions; ignores unknown fields', () => {
    const ai = markAiSuggested(null, ['title', 'price_per_day', 'is_published', 42], NOW);
    expect(Object.keys(ai).sort()).toEqual(['price_per_day', 'title']);
    expect(unconfirmedAiFields(ai)).toEqual(['title', 'price_per_day']);
    const c = confirmAiFields(ai, ['title', 'owner_id'], NOW);
    expect(unconfirmedAiFields(c)).toEqual(['price_per_day']);
    expect(c.title).toMatchObject({ status: 'confirmed', confirmed_by: 'owner_confirmed' });
  });

  it('records an owner edit as confirmation', () => {
    const c = confirmAiFields(markAiSuggested(null, ['brand'], NOW), ['brand'], NOW, 'owner_edited');
    expect(c.brand?.confirmed_by).toBe('owner_edited');
  });

  it('reads malformed stored data as nothing', () => {
    expect(readAiFields('nope')).toEqual({});
    expect(readAiFields([1, 2])).toEqual({});
    expect(readAiFields({ title: { status: 'maybe' }, bogus: { status: 'suggested' } })).toEqual({});
    expect(unconfirmedAiFields(null)).toEqual([]);
  });
});

describe('owner declarations', () => {
  it('needs all three ticks and stamps the server-side terms version and time', () => {
    const missing = buildAttestations({ owns_or_authorised: true }, NOW);
    expect(missing).toEqual({ ok: false, missing: ['condition_working', 'location_accurate'] });
    const ok = buildAttestations({ owns_or_authorised: true, condition_working: true, location_accurate: true, terms_version: 'x' }, NOW);
    expect(ok.ok && ok.value.terms_version).toBe(LISTING_POLICY.ownerTermsVersion);
    expect(ok.ok && ok.value.accepted_at).toBe(NOW.toISOString());
    expect(attestationsComplete(ok.ok ? ok.value : null)).toBe(true);
  });

  it('does not accept truthy strings as a tick', () => {
    expect(buildAttestations({ owns_or_authorised: 'yes', condition_working: 1, location_accurate: true }, NOW).ok).toBe(false);
  });
});

describe('edits to a live or queued listing', () => {
  it('sends a live listing back to draft when what was reviewed changes', () => {
    expect(editNeedsResubmission('published', ['replacement_value'])).toBe(true);
    expect(editNeedsResubmission('published', ['gallery'])).toBe(true);
    expect(editNeedsResubmission('published', ['price_per_day', 'description'])).toBe(false);
  });

  it('sends a queued listing back to draft on any change', () => {
    expect(editNeedsResubmission('pending_review', ['description'])).toBe(true);
    expect(editNeedsResubmission('pending_review', [])).toBe(false);
  });

  it('leaves drafts as drafts', () => {
    expect(editNeedsResubmission('draft', ['title'])).toBe(false);
  });
});
