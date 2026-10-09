export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkNotSuspended, checkRateLimit, requireAuth } from '@/lib/auth';
import { decideSubmission, type ListingOwnerFacts } from '@/lib/core/listings/review';
import {
  adminClient,
  forOwner,
  loadOwnerFacts,
  loadOwnListing,
  savePrivate,
  toReviewInput,
} from '@/app/api/listings/_lib/server';

/**
 * POST /api/listings/[id]/submit — the owner asks for their listing to go live.
 *
 * Runs canSubmit (verified owner, validated payout account, required fields,
 * owner declarations, no unconfirmed AI suggestions) and needsAdminReview.
 * Result: 422 with reasons, or the listing moves to `pending_review` (a
 * person looks at it) or, for an established owner, straight to `published`.
 * Every fact is read on the server; the request body is ignored.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Listing ID is required.' }, { status: 400 });

  if (!(await checkRateLimit(`listing-submit:${auth.user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  // Also clears an expired suspension, so the facts below are current.
  const suspension = await checkNotSuspended(auth.user.id);
  if (suspension.suspended) {
    return NextResponse.json(
      { error: 'Your account is suspended. Contact support.', code: 'owner_suspended' },
      { status: 403 },
    );
  }

  try {
    const admin = adminClient();
    const row = await loadOwnListing(admin, id, auth.user.id);
    if (!row) return NextResponse.json({ error: 'Listing not found or not owned by you.' }, { status: 404 });

    let owner: ListingOwnerFacts;
    try {
      owner = await loadOwnerFacts(admin, auth.user.id, row.id);
    } catch (err) {
      console.error('[listings/submit] owner facts unavailable:', err);
      return NextResponse.json({ error: 'Could not check your account. Please try again.' }, { status: 503 });
    }

    const decision = decideSubmission(toReviewInput(row), owner);
    if (!decision.ok) {
      return NextResponse.json(
        {
          error: decision.reasons.map((r) => r.message).join(' '),
          code: 'cannot_submit',
          reasons: decision.reasons,
        },
        { status: 422 },
      );
    }

    const { data, error } = await admin
      .from('smart_rentals')
      .update({ listing_status: decision.to })
      .eq('id', row.id)
      .eq('owner_id', auth.user.id)
      .eq('listing_status', row.listing_status) // nobody changed it since we read it
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'The listing changed; reload and try again.' }, { status: 409 });

    // The status change above is what counts; the submission time only
    // orders the review queue, so a failure here is logged, not fatal.
    try {
      await savePrivate(admin, row.id, { submitted_at: new Date().toISOString() });
    } catch (privErr) {
      console.error('[listings/submit] submitted_at not recorded:', privErr);
    }
    const listing = await loadOwnListing(admin, row.id, auth.user.id);

    return NextResponse.json({
      listing: listing ? forOwner(listing) : null,
      status: decision.to,
      message:
        decision.to === 'published'
          ? 'Your listing is live.'
          : 'Submitted. A person will review your listing before it goes live.',
      // Shown to the owner so they know why a review is needed.
      review_reasons: decision.review.reasons.map((r) => r.message),
    });
  } catch (err) {
    console.error('[listings/submit] error:', err);
    return NextResponse.json({ error: 'Failed to submit listing.' }, { status: 500 });
  }
}
