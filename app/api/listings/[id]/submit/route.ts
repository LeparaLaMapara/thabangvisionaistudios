export const dynamic = 'force-dynamic';
// Submitting copies the listing's photos (see cleanListingImages).
export const maxDuration = 60;

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
import { cleanListingImages, discardUploadedImages, type CleanImagesResult } from '@/app/api/listings/_lib/images';

/**
 * POST /api/listings/[id]/submit — the owner asks for their listing to go live.
 *
 * Runs canSubmit (verified owner, validated payout account, required fields,
 * owner declarations, no unconfirmed AI suggestions) and needsAdminReview.
 * Result: 422 with reasons, or the listing moves to `pending_review` (a
 * person looks at it) or, for an established owner, straight to `published`.
 * Every fact is read on the server; the request body is ignored.
 *
 * Before the status changes, every photo is replaced by a metadata-free copy
 * (cleanListingImages), so nothing that goes in front of a reviewer or a
 * renter can lead back to an original upload with GPS in it.
 *
 * The final update is conditional on the listing's updated_at being the one
 * read at the start: an edit that lands while this request is deciding makes
 * it answer 409 rather than publish on facts it never checked.
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

    let photos: CleanImagesResult;
    try {
      photos = await cleanListingImages(row);
    } catch (err) {
      console.error('[listings/submit] photo copy failed for listing', row.id, err);
      photos = { ok: false, reason: 'upload_failed' };
    }
    if (!photos.ok) {
      if (photos.reason === 'unsupported_image') {
        const reason = {
          code: 'unsupported_image',
          message: 'Upload your photos again through the listing form, then submit.',
        };
        return NextResponse.json({ error: reason.message, code: 'cannot_submit', reasons: [reason] }, { status: 422 });
      }
      console.error('[listings/submit] photos not prepared for listing', row.id, photos.reason);
      return NextResponse.json({ error: 'Could not prepare your photos. Please try again.' }, { status: 503 });
    }

    // The submission time is written BEFORE the status changes, and a
    // failure stops the submission, so a submitted listing always has it.
    // (The listing already has a listing_private row: submission requires
    // the owner declarations, which live there. Migration 072's backfill
    // relies on that row, not on this stamp.) If the status change below
    // loses a race (409), submitted_at records that attempt; it only orders
    // the review queue.
    try {
      await savePrivate(admin, row.id, { submitted_at: new Date().toISOString() });
    } catch (privErr) {
      console.error('[listings/submit] submitted_at not recorded for listing', row.id, privErr);
      await discardUploadedImages(photos.uploaded);
      return NextResponse.json({ error: 'Could not submit your listing. Please try again.' }, { status: 503 });
    }

    const { data, error } = await admin
      .from('smart_rentals')
      .update({
        listing_status: decision.to,
        ...(photos.changed && {
          gallery: photos.gallery,
          thumbnail_url: photos.thumbnail_url,
          cover_public_id: photos.cover_public_id,
        }),
      })
      .eq('id', row.id)
      .eq('owner_id', auth.user.id)
      .eq('listing_status', row.listing_status) // nobody changed its status since we read it
      .eq('updated_at', row.updated_at) // nor edited it (PUT moves updated_at)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      await discardUploadedImages(photos.uploaded);
      if (error) throw error;
      return NextResponse.json({ error: 'The listing changed while it was being submitted; reload and try again.' }, { status: 409 });
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
