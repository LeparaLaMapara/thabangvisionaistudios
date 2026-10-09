export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, requireAuth } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import {
  buildAttestations,
  checkListingTransition,
  confirmAiFields,
  editNeedsResubmission,
  markAiSuggested,
  readAiFields,
} from '@/lib/core/listings/review';
import {
  changedFields,
  depositForListing,
  listingMetadata,
  parseListingInput,
  type ListingInput,
} from '@/lib/core/listings/input';
import {
  adminClient,
  flattenListing,
  forOwner,
  loadOwnListing,
  locationOf,
  OWNER_LISTING_COLUMNS,
  savePrivate,
  type Admin,
  type OwnerListingRow,
} from '@/app/api/listings/_lib/server';
import { metadataFreeGallery, metadataFreeImageUrl } from '@/app/api/listings/_lib/images';

/**
 * Community gear listings, owner side.
 *
 *   GET     the caller's own listings (all statuses)
 *   POST    create a DRAFT. Never public on create, whatever the browser sends.
 *   PUT     edit (default), or { action: 'confirm_ai_fields', fields } or
 *           { action: 'unpublish' }
 *   DELETE  soft delete
 *
 * Going live is POST /api/listings/[id]/submit. Status, deposit, owner and
 * review fields are set here on the server (review notes, AI flags and
 * declarations in listing_private); is_published is derived from
 * listing_status by the database (migration 072).
 */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function uniqueSlug(title: string): string {
  return `${slugify(title)}-${Date.now().toString(36)}`;
}

/** Strings the edit can compare against the stored row to find what changed. */
function comparable(row: OwnerListingRow): Record<string, unknown> {
  return {
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.sub_category,
    brand: row.brand,
    model: row.model,
    price_per_day: row.price_per_day,
    replacement_value: row.replacement_value,
    serial_number: row.serial_number,
    location: locationOf(row),
    gallery: (row.gallery ?? []).map((g) => g.url),
  };
}

function incoming(input: ListingInput, existingCategory: string | null): Record<string, unknown> {
  return {
    title: input.title,
    description: input.description,
    category: input.category ?? existingCategory,
    condition: input.condition,
    brand: input.brand,
    model: input.model,
    price_per_day: input.price_per_day,
    replacement_value: input.replacement_value,
    serial_number: input.serial_number,
    location: input.location,
    gallery: (metadataFreeGallery(input.gallery) ?? []).map((g) => g.url),
  };
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

  const parsed = parseListingInput(await readJson(request), { requireCategory: true });
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
    const aiFields = input.ai_suggested_fields.length > 0 ? markAiSuggested(null, input.ai_suggested_fields, now) : null;
    const gallery = metadataFreeGallery(input.gallery);

    // Drafts may be saved before the ID check; submission enforces it.
    const { data, error } = await admin
      .from('smart_rentals')
      .insert({
        title: input.title,
        slug: uniqueSlug(input.title),
        description: input.description,
        category: input.category,
        sub_category: input.condition,
        brand: input.brand,
        model: input.model,
        price_per_day: input.price_per_day,
        replacement_value: input.replacement_value,
        deposit_amount: depositForListing(input.replacement_value),
        serial_number: input.serial_number,
        currency: STUDIO.currency.code,
        thumbnail_url: input.thumbnail_url ? metadataFreeImageUrl(input.thumbnail_url) : (gallery?.[0]?.url ?? null),
        cover_public_id: input.cover_public_id,
        gallery,
        metadata: listingMetadata(null, input.location),
        owner_type: 'community',
        owner_id: auth.user.id,
        listing_status: 'draft',
        is_published: false,
        is_available: true,
        is_ai_generated: input.ai_suggested_fields.length > 0,
        quantity: 1,
        ranking_score: 0,
      })
      .select('id')
      .single();
    if (error) throw error;

    try {
      await savePrivate(admin, data.id as string, {
        ai_fields: aiFields,
        owner_attestations: attestations?.ok ? attestations.value : null,
        replacement_value_evidence: input.replacement_value_evidence,
      });
    } catch (privErr) {
      // Without its private row the AI flags would be lost; do not keep a
      // half-saved draft. Nothing can reference a row created a moment ago.
      await admin.from('smart_rentals').delete().eq('id', data.id).eq('owner_id', auth.user.id);
      throw privErr;
    }

    return ownListingResponse(admin, data.id as string, auth.user.id, { status: 201 });
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
  if (!['update', 'confirm_ai_fields', 'unpublish'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
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
      await savePrivate(admin, row.id, { ai_fields: confirmAiFields(row.ai_fields, fields, now) });
      return ownListingResponse(admin, row.id, auth.user.id);
    }

    // ── Take a live listing down ──
    if (action === 'unpublish') {
      const check = checkListingTransition(row.listing_status, 'draft', 'owner');
      if (!check.ok) return NextResponse.json({ error: check.message, code: check.code }, { status: 409 });
      const { data, error } = await admin
        .from('smart_rentals')
        .update({ listing_status: 'draft' })
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
    const parsed = parseListingInput(body, { requireCategory: false });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    const input = parsed.value;

    const changed = changedFields(comparable(row), incoming(input, row.category));

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
      replacement_value: input.replacement_value,
      deposit_amount: depositForListing(input.replacement_value),
      serial_number: input.serial_number,
      thumbnail_url: input.thumbnail_url ? metadataFreeImageUrl(input.thumbnail_url) : (gallery?.[0]?.url ?? null),
      cover_public_id: input.cover_public_id,
      gallery,
      metadata: listingMetadata(row.metadata, input.location),
      ...(backToDraft && { listing_status: 'draft' }),
    };

    const { data, error } = await admin
      .from('smart_rentals')
      .update(updatePayload)
      .eq('id', row.id)
      .eq('owner_id', auth.user.id)
      .eq('listing_status', row.listing_status)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'The listing changed; reload and try again.' }, { status: 409 });

    await savePrivate(admin, row.id, {
      ai_fields: hasAiFields ? aiFields : null,
      owner_attestations: attestations,
      replacement_value_evidence: input.replacement_value_evidence,
    });

    return ownListingResponse(admin, row.id, auth.user.id, {
      notice: backToDraft ? 'Your changes took this listing back to draft. Submit it again to go live.' : undefined,
    });
  } catch (err) {
    console.error('[listings] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update listing.' }, { status: 500 });
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
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Listing not found or not owned by you.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[listings] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete listing.' }, { status: 500 });
  }
}

