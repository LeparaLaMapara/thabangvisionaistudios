export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAdmin, requireAdmin } from '@/lib/auth';
import { LISTING_POLICY } from '@/lib/constants';
import {
  canSubmit,
  checkListingTransition,
  isListingStatus,
  listingBlocks,
  needsAdminReview,
  ownerBlocks,
  unconfirmedAiFields,
  type ListingOwnerFacts,
  type ListingStatus,
} from '@/lib/core/listings/review';
import {
  adminClient,
  flattenListing,
  loadCommunityListing,
  loadOwnerFacts,
  notifyListingOwner,
  OWNER_LISTING_COLUMNS,
  savePrivate,
  toReviewInput,
  type ListingNotificationType,
  type OwnerListingRow,
} from '@/app/api/listings/_lib/server';

/**
 * Admin review of community listings.
 *
 *   GET   ?status=pending_review (default) | published | rejected | suspended | draft
 *         The queue, oldest submission first, with the owner's checks and the
 *         reasons a review is needed.
 *   PATCH { id, action: 'approve' | 'reject' | 'suspend' | 'reinstate', notes }
 *         Approve re-runs the submission checks (a verified owner, a validated
 *         payout account, complete listing) so an approval can never publish
 *         gear for an owner who no longer qualifies. Reject and suspend need a
 *         note, which the owner sees.
 */

const ACTIONS: Record<string, { to: ListingStatus; notify: ListingNotificationType | null }> = {
  approve: { to: 'published', notify: 'listing_approved' },
  reject: { to: 'rejected', notify: 'listing_rejected' },
  suspend: { to: 'suspended', notify: 'listing_suspended' },
  reinstate: { to: 'draft', notify: null },
};

const QUEUE_LIMIT = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const statusParam = new URL(request.url).searchParams.get('status') ?? 'pending_review';
  if (!isListingStatus(statusParam)) {
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
  }

  try {
    const admin = adminClient();
    const { data, error } = await admin
      .from('smart_rentals')
      .select(OWNER_LISTING_COLUMNS)
      .eq('owner_type', 'community')
      .eq('listing_status', statusParam)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(QUEUE_LIMIT);
    if (error) throw error;

    // Oldest submission first; never-submitted rows last.
    const rows: OwnerListingRow[] = (data ?? [])
      .map((r) => flattenListing(r))
      .sort((a, b) => (a.submitted_at ?? '\uffff').localeCompare(b.submitted_at ?? '\uffff'));
    const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id).filter((v): v is string => !!v)));

    const { data: profiles, error: profilesError } = ownerIds.length
      ? await admin.from('profiles').select('id, display_name, verification_status, is_suspended').in('id', ownerIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameById = new Map(
      ((profiles ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name]),
    );

    // Per-owner facts, loaded once per owner.
    const factsByOwner = new Map<string, ListingOwnerFacts | null>();
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        try {
          factsByOwner.set(ownerId, await loadOwnerFacts(admin, ownerId));
        } catch (err) {
          console.error('[admin/listings/review] owner facts failed:', err);
          factsByOwner.set(ownerId, null);
        }
      }),
    );

    const queue = rows.map((row) => {
      const facts = row.owner_id ? factsByOwner.get(row.owner_id) ?? null : null;
      const review = toReviewInput(row);
      // Facts include this listing; for the "first listing" view, exclude it.
      const others = facts
        ? { ...facts, publishedListings: Math.max(0, facts.publishedListings - (row.listing_status === 'published' ? 1 : 0)) }
        : null;
      return {
        ...row,
        owner_name: row.owner_id ? nameById.get(row.owner_id) ?? null : null,
        owner_checks: facts
          ? {
              id_verified: facts.verificationStatus === 'verified',
              payout_account_verified: facts.payoutAccountVerified,
              suspended: facts.isSuspended,
              open_disputes: facts.openDisputes,
              published_listings: facts.publishedListings,
              completed_rentals: facts.completedRentals,
              rejected_listings: facts.rejectedListings,
            }
          : null,
        unconfirmed_ai_fields: unconfirmedAiFields(row.ai_fields),
        blockers: [
          ...(facts ? ownerBlocks(facts).map((b) => b.message) : ["Owner checks could not be loaded; approval will be refused until they can."]),
          ...listingBlocks(review).map((b) => b.message),
        ],
        review_reasons: others ? needsAdminReview(others, review).reasons.map((r) => r.message) : [],
        high_value_threshold_cents: LISTING_POLICY.reviewValueThresholdCents,
      };
    });

    return NextResponse.json(queue);
  } catch (err) {
    console.error('[admin/listings/review] GET error:', err);
    return NextResponse.json({ error: 'Failed to load the review queue.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Send a JSON object.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const actionName = typeof body.action === 'string' ? body.action : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const action = ACTIONS[actionName];
  if (!id) return NextResponse.json({ error: 'Listing ID is required.' }, { status: 400 });
  if (!action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (notes.length > LISTING_POLICY.reviewNotesMaxLength) {
    return NextResponse.json({ error: `Notes are limited to ${LISTING_POLICY.reviewNotesMaxLength} characters.` }, { status: 400 });
  }

  try {
    const admin = adminClient();
    const row = await loadCommunityListing(admin, id);
    if (!row || !row.owner_id) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });

    const transition = checkListingTransition(row.listing_status, action.to, 'admin', notes);
    if (!transition.ok) {
      const status = transition.code === 'reason_required' ? 400 : 409;
      return NextResponse.json({ error: transition.message, code: transition.code }, { status });
    }
    if (transition.alreadyDone) return NextResponse.json({ listing: row, alreadyDone: true });

    if (action.to === 'published') {
      // Same checks the owner's submission passed, re-run now: an owner can
      // lose their verification or payout account while the listing waits.
      let facts: ListingOwnerFacts;
      try {
        facts = await loadOwnerFacts(admin, row.owner_id, row.id);
      } catch (err) {
        console.error('[admin/listings/review] owner facts failed:', err);
        return NextResponse.json({ error: "Could not check the owner's account. Try again." }, { status: 503 });
      }
      // canSubmit expects a submittable status; check the rest as if submitting.
      const check = canSubmit({ ...toReviewInput(row), listing_status: 'draft' }, facts);
      if (!check.ok) {
        return NextResponse.json(
          { error: 'This listing cannot be approved yet.', code: 'cannot_approve', reasons: check.reasons },
          { status: 422 },
        );
      }
    }

    const { data, error } = await admin
      .from('smart_rentals')
      .update({ listing_status: action.to })
      .eq('id', row.id)
      .eq('listing_status', row.listing_status) // nobody else decided it meanwhile
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'The listing changed; reload the queue.' }, { status: 409 });

    // Who decided, when and why: listing_private (not public).
    let warning: string | undefined;
    try {
      await savePrivate(admin, row.id, {
        review_notes: notes || null,
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
      });
    } catch (privErr) {
      console.error('[admin/listings/review] review record not written:', privErr);
      warning = 'The decision was saved, but the reviewer note and time were not recorded.';
    }

    if (action.notify) {
      const title = row.title;
      const messages: Record<ListingNotificationType, { title: string; body: string }> = {
        listing_approved: { title: 'Listing approved', body: `"${title}" is now live.` },
        listing_rejected: {
          title: 'Listing not approved',
          body: `"${title}" was not approved.${notes ? ` Reason: ${notes}` : ''} Edit it and submit again.`,
        },
        listing_suspended: {
          title: 'Listing taken down',
          body: `"${title}" has been taken down.${notes ? ` Reason: ${notes}` : ''} Contact support to discuss.`,
        },
      };
      const m = messages[action.notify];
      await notifyListingOwner(admin, row.owner_id, action.notify, m.title, m.body);
    }

    const listing = await loadCommunityListing(admin, row.id);
    return NextResponse.json({ listing, ...(warning && { warning }) });
  } catch (err) {
    console.error('[admin/listings/review] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to record the review.' }, { status: 500 });
  }
}
