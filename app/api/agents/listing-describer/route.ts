export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { trackedCompletion } from '@/lib/ai/tracked';
import {
  listingDescriberAgent,
  buildListingDescriberPrompt,
  parseListingDescriberOutput,
  type ListingDescriberInput,
  type ListingDescriberOutput,
} from '@/lib/agents/agents/listing-describer';

const DAILY_LIMIT = listingDescriberAgent.rateLimit.free;

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

  if (!checkRateLimit(`listing-describer:${auth.user.id}`, 5, 60_000)) {
    return NextResponse.json(
      { error: 'Please wait a moment before describing another listing.' },
      { status: 429 },
    );
  }

  if (!checkRateLimit(`listing-describer:daily:${auth.user.id}`, DAILY_LIMIT, 86_400_000)) {
    return NextResponse.json(
      { error: 'Daily listing-description limit reached.', limit: DAILY_LIMIT },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const { brand, model, category, condition, city } = body as Partial<ListingDescriberInput>;

    if (!brand || !model || !category) {
      return NextResponse.json(
        { error: 'brand, model, and category are required.' },
        { status: 400 },
      );
    }

    const input: ListingDescriberInput = {
      brand: brand.trim(),
      model: model.trim(),
      category: category.trim(),
      condition: (condition ?? 'good').trim(),
      city: city?.trim() ?? null,
    };

    const output = await trackedCompletion<ListingDescriberOutput>({
      agentId: listingDescriberAgent.id,
      provider: 'anthropic',
      model: listingDescriberAgent.model,
      userId: auth.user.id,
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

    return NextResponse.json(output);
  } catch (err) {
    console.error('[agents/listing-describer] error:', err);
    return NextResponse.json(
      { error: 'Failed to draft listing description. Please try again.' },
      { status: 500 },
    );
  }
}
