export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { trackedCompletion } from '@/lib/ai/tracked';
import {
  listingDescriberAgent,
  buildListingDescriberPrompt,
  parseListingDescriberOutput,
  type ListingDescriberInput,
  type ListingDescriberOutput,
} from '@/lib/agents/agents/listing-describer';
import { markAiSuggested, type AiSuggestibleField } from '@/lib/core/listings/review';
import { savePrivate } from '@/app/api/listings/_lib/server';

const MIN_CONFIDENCE = 0.7;

interface DetectedGearItem {
  brand: string;
  model: string;
  category: string;
  equipmentType?: string;
  condition?: string;
  confidence: number;
  thumbnailUrl?: string | null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

async function describeListing(
  input: ListingDescriberInput,
  userId: string,
): Promise<ListingDescriberOutput | null> {
  try {
    return await trackedCompletion<ListingDescriberOutput>({
      agentId: listingDescriberAgent.id,
      provider: 'anthropic',
      model: listingDescriberAgent.model,
      userId,
      call: async () => {
        const res = await generateText({
          model: anthropic(listingDescriberAgent.model),
          prompt: buildListingDescriberPrompt(input),
          temperature: 0.6,
        });
        return {
          result: parseListingDescriberOutput(res.text),
          usage: {
            inputTokens: res.usage.inputTokens ?? 0,
            outputTokens: res.usage.outputTokens ?? 0,
          },
        };
      },
    });
  } catch (err) {
    console.error('[create-rentals] describe failed for', input.brand, input.model, err);
    return null;
  }
}

// Rough daily rate heuristic from condition + category.
// Owners can edit before publishing; this is just a starting point.
function estimateDailyRate(category: string, condition: string): number {
  const base: Record<string, number> = {
    'cameras-optics': 650,
    'lighting-power': 400,
    'audio': 350,
    'grip-motion': 450,
    'specialized-solutions': 300,
  };
  const conditionMultiplier: Record<string, number> = {
    new: 1.1,
    like_new: 1.0,
    good: 0.9,
    fair: 0.75,
    for_parts: 0.4,
  };
  const categoryBase = base[category] ?? 400;
  const mult = conditionMultiplier[condition] ?? 0.9;
  return Math.round(categoryBase * mult);
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

  // New suppliers save their gear as drafts (listing_status 'draft' below)
  // before their ID check; this used to refuse every new supplier, so the last
  // onboarding step always failed. Going live is POST /api/listings/[id]/submit,
  // which requires verification, a validated payout account and, where the
  // rules say so, a person's review.
  const { data: profile } = await supabase
    .from('profiles')
    .select('location')
    .eq('id', auth.user.id)
    .single();

  try {
    const body = await req.json();
    const items = body.items as DetectedGearItem[] | undefined;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'items must be a non-empty array.' },
        { status: 400 },
      );
    }

    // Dedupe by brand+model, keep highest confidence
    const dedup = new Map<string, DetectedGearItem>();
    for (const item of items) {
      if (!item.brand || !item.model) continue;
      if (item.confidence < MIN_CONFIDENCE) continue;
      const key = `${item.brand.trim().toLowerCase()}|${item.model.trim().toLowerCase()}`;
      const existing = dedup.get(key);
      if (!existing || item.confidence > existing.confidence) {
        dedup.set(key, item);
      }
    }

    const unique = Array.from(dedup.values());
    if (unique.length === 0) {
      return NextResponse.json(
        { error: `No gear items met the ${MIN_CONFIDENCE * 100}% confidence threshold.` },
        { status: 400 },
      );
    }

    const created: Array<{ id: string; title: string; brand: string; model: string }> = [];
    const failed: Array<{ brand: string; model: string; reason: string }> = [];

    for (const item of unique) {
      const condition = item.condition ?? 'good';
      const described = await describeListing(
        {
          brand: item.brand,
          model: item.model,
          category: item.category,
          condition,
          city: profile?.location ?? null,
        },
        auth.user.id,
      );

      const fallbackTitle = `${item.brand} ${item.model}`.trim();
      const title = described?.title || fallbackTitle;
      const description = described?.description ?? null;
      const rentalIncludes = described?.rentalIncludes ?? [];

      const pricePerDay = estimateDailyRate(item.category, condition);
      const pricePerWeek = Math.round(pricePerDay * 5); // SA market norm: 7 days billed as 5

      // Everything below except the owner and location was guessed by the AI
      // (vision for brand/model/category, the describer for the words, a
      // heuristic for the rates). Each stays untrusted until the owner
      // confirms or edits it; a listing with unconfirmed fields cannot be
      // submitted (lib/core/listings/review.ts). No deposit is guessed: it is
      // computed from the replacement value the owner enters.
      const aiSuggested: AiSuggestibleField[] = [
        'title', 'brand', 'model', 'category', 'price_per_day', 'price_per_week',
        ...(description ? (['description'] as const) : []),
        ...(rentalIncludes.length > 0 ? (['rental_includes'] as const) : []),
      ];

      const { data, error } = await supabase
        .from('smart_rentals')
        .insert({
          title,
          slug: slugify(`${title}-${Date.now()}`),
          description,
          category: item.category,
          sub_category: item.equipmentType ?? null,
          brand: item.brand,
          model: item.model,
          price_per_day: pricePerDay,
          price_per_week: pricePerWeek,
          deposit_amount: null,
          currency: STUDIO.currency.code,
          thumbnail_url: item.thumbnailUrl ?? null,
          rental_includes: rentalIncludes,
          metadata: {
            ai_generated: true,
            detection_confidence: item.confidence,
            suggested_upsells: described?.suggestedUpsells ?? [],
            location: profile?.location ?? null,
          },
          owner_type: 'community',
          owner_id: auth.user.id,
          listing_status: 'draft',
          is_published: false,
          is_available: true,
          is_ai_generated: true,
          quantity: 1,
          ranking_score: 0,
        })
        .select('id, title')
        .single();

      if (error || !data) {
        failed.push({
          brand: item.brand,
          model: item.model,
          reason: error?.message ?? 'Insert failed',
        });
        continue;
      }

      // The AI flags live in listing_private (migration 072). A draft whose
      // flags could not be saved would look owner-confirmed, so it is removed.
      try {
        await savePrivate(supabase, data.id, { ai_fields: markAiSuggested(null, aiSuggested, new Date()) });
      } catch (privErr) {
        console.error('[create-rentals] AI flags not saved; draft removed:', privErr);
        await supabase.from('smart_rentals').delete().eq('id', data.id).eq('owner_id', auth.user.id);
        failed.push({ brand: item.brand, model: item.model, reason: 'Could not save the draft. Try again.' });
        continue;
      }

      created.push({ id: data.id, title: data.title, brand: item.brand, model: item.model });
    }

    return NextResponse.json({ created, failed, totalConsidered: items.length });
  } catch (err) {
    console.error('[POST /api/onboarding/create-rentals]', err);
    return NextResponse.json({ error: 'Failed to draft listings.' }, { status: 500 });
  }
}
