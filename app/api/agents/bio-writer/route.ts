export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { trackedCompletion } from '@/lib/ai/tracked';
import { releaseMessage, reserveMessage } from '@/lib/agents/usage';
import {
  bioWriterAgent,
  buildBioWriterPrompt,
  type BioWriterInput,
} from '@/lib/agents/agents/bio-writer';

const DAILY_LIMIT = bioWriterAgent.rateLimit.free;

function getTodaySAST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

async function loadBioInput(userId: string): Promise<BioWriterInput> {
  const supabase = createAdminClient();

  const [{ data: profile }, { data: analyses }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, location, years_experience')
      .eq('id', userId)
      .single(),
    supabase
      .from('portfolio_analysis')
      .select('scene_type, description, quality_score')
      .eq('creator_id', userId)
      .order('quality_score', { ascending: false })
      .limit(20),
  ]);

  // Aggregate scene percentages
  const sceneCounts: Record<string, number> = {};
  for (const row of analyses ?? []) {
    const scene = (row.scene_type ?? '').toLowerCase();
    if (!scene) continue;
    sceneCounts[scene] = (sceneCounts[scene] ?? 0) + 1;
  }
  const total = Object.values(sceneCounts).reduce((a, b) => a + b, 0) || 1;
  const topSceneTypes = Object.entries(sceneCounts)
    .map(([name, count]) => ({
      name: name.replace(/_/g, ' '),
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const topDescriptions = (analyses ?? [])
    .slice(0, 5)
    .map((a) => a.description as string)
    .filter(Boolean);

  return {
    displayName: profile?.display_name ?? null,
    location: profile?.location ?? null,
    yearsExperience: profile?.years_experience ?? null,
    topSceneTypes,
    detectedGear: [],
    topDescriptions,
  };
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

  if (!(await checkRateLimit(`bio-writer:${auth.user.id}`, 3, 60_000))) {
    return NextResponse.json(
      { error: 'Please wait a moment before generating again.' },
      { status: 429 },
    );
  }

  // Daily limit via ubunye_usage: one slot RESERVED atomically before the
  // model is called (078), given back if no bio is produced. The old
  // read-then-write let parallel requests pass the cap (security LLM-6).
  const supabase = createAdminClient();
  const slot = { userId: auth.user.id, date: getTodaySAST() };
  let reservation;
  try {
    reservation = await reserveMessage(supabase, { ...slot, limit: DAILY_LIMIT });
  } catch (err) {
    console.error('[agents/bio-writer] usage reserve failed:', err);
    return NextResponse.json({ error: 'Bio generation is unavailable just now.' }, { status: 503 });
  }
  if (reservation.kind === 'limit_reached') {
    return NextResponse.json(
      { error: 'Daily bio-generation limit reached.', limit: DAILY_LIMIT },
      { status: 429 },
    );
  }

  try {
    const input = await loadBioInput(auth.user.id);

    const bio = await trackedCompletion<string>({
      agentId: bioWriterAgent.id,
      provider: 'anthropic',
      model: bioWriterAgent.model,
      userId: auth.user.id,
      call: async () => {
        const res = await generateText({
          model: anthropic(bioWriterAgent.model),
          prompt: buildBioWriterPrompt(input),
          temperature: 0.7,
        });
        return {
          result: res.text.trim(),
          usage: {
            inputTokens: res.usage.inputTokens ?? 0,
            outputTokens: res.usage.outputTokens ?? 0,
          },
        };
      },
    });

    return NextResponse.json({ bio, samples: input.topSceneTypes.length });
  } catch (err) {
    console.error('[agents/bio-writer] error:', err);
    // No bio was produced: the slot is given back.
    try {
      await releaseMessage(supabase, slot);
    } catch (releaseErr) {
      console.error('[agents/bio-writer] usage release failed:', releaseErr);
    }
    return NextResponse.json(
      { error: 'Failed to generate bio. Please try again.' },
      { status: 500 },
    );
  }
}
