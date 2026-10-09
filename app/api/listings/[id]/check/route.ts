export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, requireAuth } from '@/lib/auth';
import { precheckSubmission, type ListingOwnerFacts } from '@/lib/core/listings/review';
import { adminClient, loadOwnerFacts, loadOwnListing, toReviewInput } from '@/app/api/listings/_lib/server';

/**
 * GET /api/listings/[id]/check — what submitting would say, before the
 * owner presses Submit. Read-only: it changes nothing and records nothing.
 *
 * Runs the same rules as POST /api/listings/[id]/submit (canSubmit and
 * needsAdminReview, on facts the server loads itself) and returns:
 *   ownerBlocks     ID check, validated payout account, suspension
 *   listingBlocks   missing fields, declarations, unconfirmed AI suggestions
 *   statusBlock     the listing's status does not allow a submission
 *   review          whether a person will review it, and why
 *   canSubmit       true when nothing blocks
 * Submit re-checks everything; this answer is a preview, not a promise.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Listing ID is required.' }, { status: 400 });

  if (!(await checkRateLimit(`listing-check:${auth.user.id}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  try {
    const admin = adminClient();
    const row = await loadOwnListing(admin, id, auth.user.id);
    if (!row) return NextResponse.json({ error: 'Listing not found or not owned by you.' }, { status: 404 });

    let owner: ListingOwnerFacts;
    try {
      owner = await loadOwnerFacts(admin, auth.user.id, row.id);
    } catch (err) {
      console.error('[listings/check] owner facts unavailable:', err);
      return NextResponse.json({ error: 'Could not check your account. Please try again.' }, { status: 503 });
    }

    return NextResponse.json(precheckSubmission(toReviewInput(row), owner));
  } catch (err) {
    console.error('[listings/check] error:', err);
    return NextResponse.json({ error: 'Could not check this listing.' }, { status: 500 });
  }
}
