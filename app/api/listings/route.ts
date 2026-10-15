export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkNotSuspended, checkRateLimit, requireAuth } from '@/lib/auth';
import {
  buildAttestations,
  checkListingTransition,
  confirmAiFields,
  editNeedsResubmission,
  resubmissionNotice,
  markAiSuggested,
  readAiFields,
  weekRateProblem,
} from '@/lib/core/listings/review';
import {
  changedFields,
  depositForListing,
  listingMetadata,
  parseListingInput,
  sameIncludes,
  type ListingInput,
} from '@/lib/core/listings/input';
import {
  adminClient,
  flattenListing,
  forOwner,
  isOwnerSuspended,
  loadOwnListing,
  locationOf,
  OWNER_LISTING_COLUMNS,
  savePrivateIfUnchanged,
  type Admin,
  type OwnerListingRow,
} from '@/app/api/listings/_lib/server';
import { insertDraft } from '@/app/api/listings/_lib/drafts';
import { isOwnImageUrl, metadataFreeGallery, metadataFreeImageUrl } from '@/app/api/listings/_lib/images';
import { notifyDiscovery } from '@/lib/discovery/notify';
import { rentalPaths } from '@/lib/discovery/paths';

/**
 * Community gear listings, owner side.
 *
 *   GET     the caller's own listings (all statuses)
 *   POST    create a DRAFT. Never public on create, whatever the browser sends.
 *   PUT     edit (default), or { action: 'confirm_ai_fields', fields },
 *           { action: 'attest', attestations } (the three owner declarations,
 *           given at the submit step) or { action: 'unpublish' }
 *   DELETE  soft delete
 *
 * Going live is POST /api/listings/[id]/submit. Status, deposit, owner and
 * review fields are set here on the server (review notes, AI flags and
 * declarations in listing_private); is_published is derived from
 * listing_status by the database (migration 072).
 */

/** A gallery as comparable strings: a photo swapped under the same URL (or id) is a change. */
function galleryKeys(gallery: { url: string; public_id: string }[] | null | undefined): string[] {
  return (gallery ?? []).map((g) => `${g.url}|${g.public_id ?? ''}`);
}

/** The stored values the edit can compare against to find what changed. */
function comparable(row: OwnerListingRow): Record<string, unknown> {
  return {
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.sub_category,
    brand: row.brand,
    model: row.model,
    price_per_day: row.price_per_day,
    price_per_week: row.price_per_week,
    replacement_value: row.replacement_value,
    rental_includes: row.rental_includes ?? [],
    serial_number: row.serial_number,
    location: locationOf(row),
    gallery: galleryKeys(row.gallery),
    thumbnail_url: row.thumbnail_url,
  };
}

/**
 * What's included after this edit. Not sent, or sent back the same once
 * normalised (trimmed, blanks and repeats dropped), keeps the stored list
 * exactly as stored: re-saving a form is not an edit of what's included.
 */
function includesAfterEdit(input: ListingInput, row: OwnerListingRow): string[] {
  const stored = row.rental_includes ?? [];
  if (input.rental_includes === undefined || sameIncludes(input.rental_includes, stored)) return stored;
  return input.rental_includes;
}

/**
 * What the row will hold after this edit, in the same shape as comparable().
 * Week rate and what's included keep their stored value when not sent.
 */
function incoming(input: ListingInput, row: OwnerListingRow): Record<string, unknown> {
  return {
    title: input.title,
    description: input.description,
    category: input.category ?? row.category,
    condition: input.condition,
    brand: input.brand,
    model: input.model,
    price_per_day: input.price_per_day,
    price_per_week: weekRateAfterEdit(input, row),
    replacement_value: input.replacement_value,
    rental_includes: includesAfterEdit(input, row),
    serial_number: input.serial_number,
    location: input.location,
    gallery: galleryKeys(metadataFreeGallery(input.gallery)),
    thumbnail_url: input.thumbnail_url ? metadataFreeImageUrl(input.thumbnail_url) : null,
  };
}

function weekRateAfterEdit(input: ListingInput, row: OwnerListingRow): number | null {
  if (input.price_per_week !== undefined) return input.price_per_week;
  return row.price_per_week === null ? null : Number(row.price_per_week);
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ─── GET — the caller's own community listings ──────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const { data, error } = await adminClient()
      .from('smart_rentals')
      .select(OWNER_LISTING_COLUMNS)
      .eq('owner_id', auth.user.id)
      .eq('owner_type', 'community')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json((data ?? []).map((r) => forOwner(flattenListing(r))));
  } catch (err) {
    console.error('[listings] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch listings.' }, { status: 500 });
  }
}

/** Re-reads the caller's listing (with its private row) for the response. */
async function ownListingResponse(
  admin: Admin,
  id: string,
  ownerId: string,
  init?: { status?: number; notice?: string },
): Promise<NextResponse> {
  const row = await loadOwnListing(admin, id, ownerId);
  if (!row) return NextResponse.json({ error: 'Listing not found or not owned by you.' }, { status: 404 });
  return NextResponse.json(
    { ...forOwner(row), ...(init?.notice && { notice: init.notice }) },
    { status: init?.status ?? 200 },
  );
}

// ─── POST — create a draft ──────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (!(await checkRateLimit(`listing:${auth.user.id}`, 5, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const parsed = parseListingInput(await readJson(request), {
    requireCategory: true,
    // Photos come from the listing form's upload to our storage account.
    isAllowedImageUrl: (url) => isOwnImageUrl(url),
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  }
  const input = parsed.value;

  try {
    const admin = adminClient();

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('is_suspended')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.is_suspended) {
      return NextResponse.json({ error: 'Your account is suspended. Contact support.' }, { status: 403 });
    }

    const now = new Date();
    const attestations = input.attestations !== undefined ? buildAttestations(input.attestations, now) : null;

    // Drafts may be saved before the ID check; submission enforces it.
    const id = await insertDraft(
      admin,
      auth.user.id,
      {
        title: input.title,
        description: input.description,
        category: input.category,
        condition: input.condition,
        brand: input.brand,
        model: input.model,
        price_per_day: input.price_per_day,
        price_per_week: input.price_per_week ?? null,
        replacement_value: input.replacement_value,
        rental_includes: input.rental_includes ?? [],
        serial_number: input.serial_number,
        location: input.location,
        gallery: metadataFreeGallery(input.gallery),
        // Always one of the gallery photos (parseListingInput), served metadata-free.
        thumbnail_url: input.thumbnail_url ? metadataFreeImageUrl(input.thumbnail_url) : null,
        cover_public_id: input.cover_public_id,
      },
      {
        source: 'dashboard',
        aiSuggested: input.ai_suggested_fields,
        attestations: attestations?.ok ? attestations.value : null,
        replacementValueEvidence: input.replacement_value_evidence,
        now,
      },
    );

    return ownListingResponse(admin, id, auth.user.id, { status: 201 });
  } catch (err) {
    console.error('[listings] POST error:', err);
    return NextResponse.json({ error: 'Failed to create listing.' }, { status: 500 });
  }
}

// ─── PUT — edit, confirm AI fields, or unpublish (ownership enforced) ───────

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (!(await checkRateLimit(`listing-edit:${auth.user.id}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const body = await readJson(request);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Send the listing as a JSON object.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const id = typeof b.id === 'string' ? b.id : '';
  if (!id) return NextResponse.json({ error: 'Listing ID is required.' }, { status: 400 });

  const action = typeof b.action === 'string' ? b.action : 'update';
  if (!['update', 'confirm_ai_fields', 'attest', 'unpublish'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  // A suspended owner may still take a listing down, nothing else.
  // checkNotSuspended also clears an expired suspension, but it answers "not
  // suspended" when its read fails; isOwnerSuspended then re-reads and fails
  // closed (503) so a database error never lets a suspended owner edit.
  if (action !== 'unpublish') {
    const suspension = await checkNotSuspended(auth.user.id);
    let suspended = suspension.suspended;
    if (!suspended) {
      try {
        suspended = await isOwnerSuspended(adminClient(), auth.user.id);
      } catch (err) {
        console.error('[listings] PUT: suspension check failed:', err);
        return NextResponse.json({ error: 'Could not check your account. Please try again.' }, { status: 503 });
      }
    }
    if (suspended) {
      return NextResponse.json(
        { error: 'Your account is suspended. Contact support.', code: 'owner_suspended' },
        { status: 403 },
      );
    }
  }

  try {
    const admin = adminClient();
    const row = await loadOwnListing(admin, id, auth.user.id);
    if (!row) return NextResponse.json({ error: 'Listing not found or not owned by you.' }, { status: 404 });
    if (row.listing_status === 'suspended') {
      return NextResponse.json({ error: 'This listing is suspended. Contact support.' }, { status: 403 });
    }

    const now = new Date();

    // ── Confirm AI suggestions as correct ──
    if (action === 'confirm_ai_fields') {
      const fields = Array.isArray(b.fields) ? b.fields : [];
      if (fields.length === 0) return NextResponse.json({ error: 'Say which fields to confirm.' }, { status: 400 });
      // Only onto the private row this request read: confirming from a stale
      // copy would drop AI markers an edit added meanwhile.
      const written = await savePrivateIfUnchanged(
        admin,
        row.id,
        { ai_fields: confirmAiFields(row.ai_fields, fields, now) },
        row.private_updated_at,
      );
      if (!written) return NextResponse.json({ error: 'The listing changed; reload and try again.' }, { status: 409 });
      return ownListingResponse(admin, row.id, auth.user.id);
    }

    // ── The owner declarations, given at the submit step ──
    // Stored like an edit's declarations, but nothing else changes. Only on
    // a listing that can be submitted; all three must be ticked.
    if (action === 'attest') {
      if (row.listing_status !== 'draft' && row.listing_status !== 'rejected') {
        return NextResponse.json(
          { error: 'Only a draft, or a listing that was not approved, can be submitted.' },
          { status: 409 },
        );
      }
      const built = buildAttestations(b.attestations, now);
      if (!built.ok) {
        return NextResponse.json(
          { error: 'Tick all three declarations to submit.', field: 'attestations', missing: built.missing },
          { status: 400 },
        );
      }
      const written = await savePrivateIfUnchanged(admin, row.id, { owner_attestations: built.value }, row.private_updated_at);
      if (!written) return NextResponse.json({ error: 'The listing changed; reload and try again.' }, { status: 409 });
      return ownListingResponse(admin, row.id, auth.user.id);
    }

    // ── Take a live listing down ──
    if (action === 'unpublish') {
      const check = checkListingTransition(row.listing_status, 'draft', 'owner');
      if (!check.ok) return NextResponse.json({ error: check.message, code: check.code }, { status: 409 });
      const { data, error } = await admin
        .from('smart_rentals')
        .update({ listing_status: 'draft', updated_at: now.toISOString() })
        .eq('id', row.id)
        .eq('owner_id', auth.user.id)
        .eq('listing_status', row.listing_status)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'The listing changed; reload and try again.' }, { status: 409 });
      return ownListingResponse(admin, row.id, auth.user.id);
    }

    // ── Edit ──
    // Photos already on this listing may stay; new ones must come from our
    // storage account. Stored what's-included items pass the item limits.
    const storedImageUrls = new Set([...(row.gallery ?? []).map((g) => g.url), ...(row.thumbnail_url ? [row.thumbnail_url] : [])]);
    const parsed = parseListingInput(body, {
      requireCategory: false,
      storedIncludes: row.rental_includes,
      isAllowedImageUrl: (url) => storedImageUrls.has(url) || isOwnImageUrl(url),
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    const input = parsed.value;

    // The week rate is charged for whole weeks of a long hire, so it is
    // checked against the day rate the listing will have after this edit.
    const weekRate = weekRateAfterEdit(input, row);
    const weekProblem = weekRateProblem(input.price_per_day, weekRate);
    if (weekProblem) return NextResponse.json({ error: weekProblem, field: 'price_per_week' }, { status: 400 });

    const changed = changedFields(comparable(row), incoming(input, row));

    // A changed AI-suggested value is the owner's own value now.
    let aiFields = confirmAiFields(row.ai_fields, changed, now, 'owner_edited');
    if (input.ai_suggested_fields.length > 0) {
      aiFields = markAiSuggested(aiFields, input.ai_suggested_fields, now);
    }
    const hasAiFields = Object.keys(readAiFields(aiFields)).length > 0;

    let attestations: unknown = row.owner_attestations;
    if (input.attestations !== undefined) {
      const built = buildAttestations(input.attestations, now);
      attestations = built.ok ? built.value : null;
    }

    // What a reviewer approved must still be what renters see.
    const backToDraft = editNeedsResubmission(row.listing_status, changed);
    const gallery = metadataFreeGallery(input.gallery);

    const updatePayload: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      ...(input.category && { category: input.category }),
      sub_category: input.condition,
      brand: input.brand,
      model: input.model,
      price_per_day: input.price_per_day,
      price_per_week: weekRate,
      replacement_value: input.replacement_value,
      deposit_amount: depositForListing(input.replacement_value),
      rental_includes: includesAfterEdit(input, row),
      serial_number: input.serial_number,
      // Always one of the gallery photos (parseListingInput), served metadata-free.
      thumbnail_url: input.thumbnail_url ? metadataFreeImageUrl(input.thumbnail_url) : null,
      cover_public_id: input.cover_public_id,
      gallery,
      metadata: listingMetadata(row.metadata, input.location),
      // Set here as well as by the set_updated_at trigger: submission
      // compares it to spot an edit that landed while it was deciding.
      updated_at: now.toISOString(),
      ...(backToDraft && { listing_status: 'draft' }),
    };

    // Private row first, then the listing row (which moves updated_at). A
    // submission that read the listing before this edit then fails its
    // updated_at check (409) instead of publishing on half-old facts.
    // Both writes are conditional on what this request read, so of two
    // concurrent edits one wins whole and the other gets 409 having changed
    // nothing: the private row only if it is still the version read here,
    // the listing only if its status and updated_at are.
    const privateWritten = await savePrivateIfUnchanged(
      admin,
      row.id,
      {
        ai_fields: hasAiFields ? aiFields : null,
        owner_attestations: attestations,
        replacement_value_evidence: input.replacement_value_evidence,
      },
      row.private_updated_at,
    );
    if (!privateWritten) {
      return NextResponse.json({ error: 'The listing changed; reload and try again.' }, { status: 409 });
    }

    const { data, error } = await admin
      .from('smart_rentals')
      .update(updatePayload)
      .eq('id', row.id)
      .eq('owner_id', auth.user.id)
      .eq('listing_status', row.listing_status)
      .eq('updated_at', row.updated_at)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      // The listing was not saved; put the private row back as it was, but
      // only if it still holds what this request wrote.
      await restorePrivate(admin, row, privateWritten);
      if (error) throw error;
      return NextResponse.json({ error: 'The listing changed; reload and try again.' }, { status: 409 });
    }

    // A live listing that changed (or went back to draft) changes its public page.
    if (row.listing_status === 'published') notifyDiscovery(rentalPaths(row));

    return ownListingResponse(admin, row.id, auth.user.id, {
      notice: backToDraft
        ? row.listing_status === 'published'
          ? resubmissionNotice(changed)
          : 'Your changes took this listing back to draft. Submit it again when it is ready.'
        : undefined,
    });
  } catch (err) {
    console.error('[listings] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update listing.' }, { status: 500 });
  }
}

/**
 * Puts back the private values read at the start, only while the private
 * row is still the version this request wrote (`written`): if anyone has
 * written it since, their data stays. Best effort: a failure is logged
 * (listing id only); the caller's answer stands.
 */
async function restorePrivate(admin: Admin, row: OwnerListingRow, written: string): Promise<void> {
  try {
    const restored = await savePrivateIfUnchanged(
      admin,
      row.id,
      {
        ai_fields: row.ai_fields,
        owner_attestations: row.owner_attestations,
        replacement_value_evidence: row.replacement_value_evidence,
      },
      written,
    );
    if (!restored) console.warn('[listings] PUT: private row changed meanwhile, left as is for listing', row.id);
  } catch (err) {
    console.error('[listings] PUT: private row not restored for listing', row.id, err);
  }
}

// ─── DELETE — soft delete (ownership enforced) ──────────────────────────────

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await readJson(request);
  const id = body && typeof body === 'object' && typeof (body as Record<string, unknown>).id === 'string'
    ? ((body as Record<string, unknown>).id as string)
    : '';
  if (!id) return NextResponse.json({ error: 'Listing ID is required.' }, { status: 400 });

  try {
    const { data, error } = await adminClient()
      .from('smart_rentals')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', auth.user.id)
      .eq('owner_type', 'community')
      .is('deleted_at', null)
      .select('id, category, slug, owner_type, owner_id, is_published');

    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Listing not found or not owned by you.' }, { status: 404 });
    }
    const wasLive = data.filter((r: { is_published: boolean | null }) => r.is_published);
    if (wasLive.length > 0) notifyDiscovery(wasLive.flatMap(rentalPaths));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[listings] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete listing.' }, { status: 500 });
  }
}

