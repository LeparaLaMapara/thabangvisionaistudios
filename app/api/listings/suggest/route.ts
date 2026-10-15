export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { aiBudgetResponse } from '@/lib/ai/budget-response';
import { checkNotSuspended, checkRateLimit, requireAuth } from '@/lib/auth';
import { identifyGear } from '@/lib/agents/tools';
import { describeListing, listingDescriberAgent } from '@/lib/agents/agents/listing-describer';
import { parseListingInput } from '@/lib/core/listings/input';
import { isLowConfidence, profileLocation, suggestListing, type GearFacts, type DescribedGear } from '@/lib/core/listings/suggest';
import { adminClient, forOwner, isOwnerSuspended, loadOwnListing } from '@/app/api/listings/_lib/server';
import { insertDraft } from '@/app/api/listings/_lib/drafts';
import { isOwnImageUrl, metadataFreeGallery, metadataFreeImageUrl } from '@/app/api/listings/_lib/images';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/listings/suggest — photo first (spec §9.3).
 *
 * Body: { gallery: [{ url, public_id }], cover_public_id? } — photos the
 * listing form uploaded to our storage account.
 *
 * Recognises the gear in the cover photo (vision), drafts the words (the
 * listing describer) and suggests a day and week rate (the heuristic in
 * lib/core/listings/suggest.ts), then creates a DRAFT with those values. The
 * draft is created here, on the server, so every pre-filled field is
 * recorded in listing_private.ai_fields as `suggested` whatever the browser
 * does; the owner confirms or changes each one before the listing can be
 * submitted. No replacement value is suggested. The location comes from the
 * owner's profile (city, province) and is not an AI value.
 *
 * AI use is tracked (trackedCompletion, registered agents) and limited with
 * the same per-user limits as the onboarding identify step and the listing
 * describer, so this route adds no new allowance.
 */

const VISION_DAILY_LIMIT = 50;
const DAY_MS = 86_400_000;

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const userId = auth.user.id;

  const suspension = await checkNotSuspended(userId);
  if (suspension.suspended) {
    return NextResponse.json({ error: 'Your account is suspended. Contact support.', code: 'owner_suspended' }, { status: 403 });
  }

  // Creating a draft (same budget as the form), one vision call, one describer call.
  if (!(await checkRateLimit(`listing:${userId}`, 5, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }
  if (!(await checkRateLimit(`agents:onboarding:${userId}`, VISION_DAILY_LIMIT, DAY_MS))) {
    return NextResponse.json(
      { error: 'Daily limit for photo suggestions reached. Fill in the details yourself, or try tomorrow.', code: 'ai_limit' },
      { status: 429 },
    );
  }

  // Only photos from our own storage account, like the listing form.
  const body = await readJson(request);
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const parsed = parseListingInput(
    { title: 'photo', gallery: b.gallery, cover_public_id: b.cover_public_id },
    { requireCategory: false, isAllowedImageUrl: (url) => isOwnImageUrl(url) },
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const gallery = metadataFreeGallery(parsed.value.gallery);
  if (!gallery || gallery.length === 0) {
    return NextResponse.json({ error: 'Add at least one photo first.', field: 'gallery' }, { status: 400 });
  }
  const cover = parsed.value.thumbnail_url ? metadataFreeImageUrl(parsed.value.thumbnail_url) : gallery[0].url;

  try {
    const admin = adminClient();
    // Fails closed: a read error is not "not suspended".
    let suspended: boolean;
    try {
      suspended = await isOwnerSuspended(admin, userId);
    } catch (err) {
      console.error('[listings/suggest] suspension check failed:', err);
      return NextResponse.json({ error: 'Could not check your account. Please try again.' }, { status: 503 });
    }
    if (suspended) {
      return NextResponse.json({ error: 'Your account is suspended. Contact support.', code: 'owner_suspended' }, { status: 403 });
    }

    // A retry of the same suggestion (the response was lost) returns the draft
    // it already created instead of making a second one. The browser sends one
    // request id per photo set.
    const requestId = typeof b.request_id === 'string' && UUID.test(b.request_id) ? b.request_id : null;
    if (requestId) {
      const { data: earlier, error: earlierErr } = await admin
        .from('smart_rentals')
        .select('id')
        .eq('owner_id', userId)
        .eq('metadata->>suggest_request_id', requestId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (earlierErr) {
        console.error('[listings/suggest] retry lookup failed:', earlierErr.message);
        return NextResponse.json({ error: 'Could not check for an earlier draft. Please try again.' }, { status: 503 });
      }
      if (earlier) {
        const listing = await loadOwnListing(admin, (earlier as { id: string }).id, userId);
        return NextResponse.json({ listing: listing ? forOwner(listing) : null, repeated: true }, { status: 200 });
      }
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('city, province, location')
      .eq('id', userId)
      .maybeSingle();
    const location = profileLocation(profile as { city?: string | null; province?: string | null; location?: string | null } | null);

    // 1. What is in the photo. The metadata-free delivery is sent, so the
    //    photo's EXIF (GPS) never reaches the AI provider.
    let facts: GearFacts | null = null;
    try {
      const id = await identifyGear(cover, userId);
      const conf = Number(id.confidence);
      facts = {
        brand: id.brand,
        model: id.model,
        category: id.category,
        condition: id.condition,
        equipmentType: id.equipmentType,
        confidence: Number.isFinite(conf) ? (conf > 1 ? conf / 100 : conf) : null,
      };
    } catch (err) {
      console.error('[listings/suggest] vision failed:', err);
      const budgetRes = aiBudgetResponse(err);
      if (budgetRes) return budgetRes;
    }
    if (!facts || !(facts.brand || facts.model)) {
      return NextResponse.json(
        { error: 'We could not recognise the gear in that photo. Fill in the details yourself.', code: 'not_recognised' },
        { status: 422 },
      );
    }

    // 2. The words, only for a confident recognition and within the describer's limits.
    let described: DescribedGear | null = null;
    const describerAllowed =
      !isLowConfidence(facts) &&
      (await checkRateLimit(`listing-describer:${userId}`, 5, 60_000)) &&
      (await checkRateLimit(`listing-describer:daily:${userId}`, listingDescriberAgent.rateLimit.free, DAY_MS));
    if (describerAllowed && facts.brand && facts.model && facts.category) {
      try {
        described = await describeListing(
          { brand: facts.brand, model: facts.model, category: facts.category, condition: facts.condition ?? 'good', city: location },
          userId,
        );
      } catch (err) {
        console.error('[listings/suggest] describer failed:', err);
      }
    }

    // 3. The draft. Every value that came from the AI or the rate heuristic is marked suggested.
    const suggestion = suggestListing({ facts, described, location });
    const v = suggestion.values;
    const newId = await insertDraft(
      admin,
      userId,
      {
        title: v.title,
        description: v.description,
        category: v.category,
        condition: v.condition,
        brand: v.brand,
        model: v.model,
        price_per_day: v.price_per_day,
        price_per_week: v.price_per_week,
        replacement_value: null,
        rental_includes: v.rental_includes,
        serial_number: null,
        location: v.location,
        gallery,
        thumbnail_url: cover,
        cover_public_id: parsed.value.cover_public_id,
      },
      {
        source: 'ai',
        aiSuggested: suggestion.aiSuggested,
        metadata: {
          ai_generated: true,
          suggest_request_id: requestId,
          detection_confidence: facts.confidence ?? null,
          equipment_type: facts.equipmentType ?? null,
          suggested_upsells: [],
        },
      },
    );

    const listing = await loadOwnListing(admin, newId, userId);
    return NextResponse.json(
      {
        listing: listing ? forOwner(listing) : null,
        ai_suggested_fields: suggestion.aiSuggested,
        low_confidence: suggestion.lowConfidence,
        location_from_profile: Boolean(location),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[listings/suggest] error:', err);
    const budgetRes = aiBudgetResponse(err);
    if (budgetRes) return budgetRes;
    return NextResponse.json({ error: 'Could not suggest details. Fill them in yourself, or try again.' }, { status: 500 });
  }
}
