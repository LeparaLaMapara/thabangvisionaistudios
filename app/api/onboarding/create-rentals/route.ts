export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { aiBudgetResponse } from '@/lib/ai/budget-response';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { describeListing, listingDescriberAgent, type ListingDescriberOutput } from '@/lib/agents/agents/listing-describer';
import {
  isLowConfidence,
  onboardingItemKey,
  parseOnboardingItem,
  profileLocation,
  suggestListing,
  type OnboardingItem,
} from '@/lib/core/listings/suggest';
import { insertDraft } from '@/app/api/listings/_lib/drafts';
import { isOwnImageUrl, metadataFreeImageUrl } from '@/app/api/listings/_lib/images';

/**
 * POST /api/onboarding/create-rentals — the gear step of onboarding turns
 * each photo into a DRAFT listing.
 *
 * What the owner typed on that step (name, category, condition, day rate)
 * is used as their own value; what vision recognised and the describer
 * wrote is used where the owner did not change it, and is recorded as
 * AI-suggested (lib/core/listings/suggest.ts), so the owner must confirm it
 * before submitting. An item vision was not sure about is still saved as a
 * draft, flagged in the answer (`lowConfidence`) so the owner is told to
 * check every detail; the describer is not asked to write about a guess.
 * No replacement value is guessed. The location is the profile's city and
 * province. Going live is POST /api/listings/[id]/submit.
 */

const MAX_ITEMS = 20;

function httpsUrl(v: string): boolean {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const suspension = await checkNotSuspended(auth.user.id);
  if (suspension.suspended) {
    return NextResponse.json(
      { error: `Account suspended: ${suspension.reason ?? 'Contact support.'}` },
      { status: 403 },
    );
  }

  if (!(await checkRateLimit(`create-rentals:${auth.user.id}`, 2, 60_000))) {
    return NextResponse.json(
      { error: 'Please wait before drafting listings again.' },
      { status: 429 },
    );
  }

  const supabase = createAdminClient();

  // New suppliers save their gear as drafts before their ID check. Going
  // live requires verification, a validated payout account and, where the
  // rules say so, a person's review.
  const { data: profile } = await supabase
    .from('profiles')
    .select('city, province, location')
    .eq('id', auth.user.id)
    .maybeSingle();
  const location = profileLocation(profile as { city?: string | null; province?: string | null; location?: string | null } | null);

  try {
    const body = (await req.json()) as { items?: unknown };
    const raw = body?.items;

    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json(
        { error: 'items must be a non-empty array.' },
        { status: 400 },
      );
    }

    // Drop items with nothing to make a draft from, and duplicates (same
    // name, brand and model), keeping the most confident recognition.
    const dedup = new Map<string, OnboardingItem>();
    let skipped = 0;
    for (const entry of raw.slice(0, MAX_ITEMS)) {
      const item = parseOnboardingItem(entry);
      if (!item) {
        skipped += 1;
        continue;
      }
      const key = onboardingItemKey(item, item.owner.title ?? '');
      const existing = dedup.get(key);
      if (!existing || (item.facts?.confidence ?? 0) > (existing.facts?.confidence ?? 0)) dedup.set(key, item);
    }

    const unique = Array.from(dedup.values());
    if (unique.length === 0) {
      return NextResponse.json(
        { error: 'Give each item a name, or add a clearer photo.' },
        { status: 400 },
      );
    }

    const created: Array<{ id: string; title: string; lowConfidence: boolean }> = [];
    const failed: Array<{ title: string; reason: string }> = [];

    for (const item of unique) {
      const facts = item.facts;
      let described: ListingDescriberOutput | null = null;
      // Each AI description counts against the same daily allowance as the
      // listing suggest route; once it is used up, items are drafted from the
      // photo identification and the rate heuristic alone.
      if (
        facts && !isLowConfidence(facts) && facts.brand && facts.model &&
        (await checkRateLimit(`listing-describer:daily:${auth.user.id}`, listingDescriberAgent.rateLimit.free, 86_400_000))
      ) {
        try {
          described = await describeListing(
            {
              brand: facts.brand,
              model: facts.model,
              category: item.owner.category ?? facts.category ?? '',
              condition: item.owner.condition ?? facts.condition ?? 'good',
              city: location,
            },
            auth.user.id,
          );
        } catch (err) {
          console.error('[create-rentals] describe failed:', err);
        }
      }

      const suggestion = suggestListing({ facts, described, owner: item.owner, location });
      const v = suggestion.values;
      if (!v.category) {
        failed.push({ title: v.title, reason: 'Choose a category for this item.' });
        continue;
      }

      // The photo becomes the listing's one gallery image and its cover, so
      // the cover is always one of the photos a reviewer sees. Only a photo
      // in our own storage account is kept (the onboarding upload puts it
      // there); anything else is left off and the owner adds photos later.
      const photoUrl =
        item.photoUrl && httpsUrl(item.photoUrl) && isOwnImageUrl(item.photoUrl)
          ? metadataFreeImageUrl(item.photoUrl)
          : null;

      try {
        const id = await insertDraft(
          supabase,
          auth.user.id,
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
            gallery: photoUrl ? [{ url: photoUrl, public_id: '' }] : [],
            thumbnail_url: photoUrl,
            cover_public_id: null,
          },
          {
            source: 'onboarding',
            aiSuggested: suggestion.aiSuggested,
            metadata: {
              ai_generated: suggestion.aiSuggested.length > 0,
              detection_confidence: facts?.confidence ?? null,
              equipment_type: facts?.equipmentType ?? null,
              suggested_upsells: described?.suggestedUpsells ?? [],
            },
          },
        );
        created.push({ id, title: v.title, lowConfidence: suggestion.lowConfidence });
      } catch (err) {
        console.error('[create-rentals] draft not saved:', err);
        failed.push({ title: v.title, reason: 'Could not save the draft. Try again.' });
      }
    }

    return NextResponse.json({
      created,
      failed,
      lowConfidence: created.filter((c) => c.lowConfidence).length,
      skipped,
      totalConsidered: raw.length,
    });
  } catch (err) {
    console.error('[POST /api/onboarding/create-rentals]', err);
    const budgetRes = aiBudgetResponse(err);
    if (budgetRes) return budgetRes;
    return NextResponse.json({ error: 'Failed to draft listings.' }, { status: 500 });
  }
}
