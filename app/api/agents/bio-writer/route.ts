export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { generateWithFallback } from '@/lib/ai';
import { trackedCompletion } from '@/lib/ai/tracked';
import { releaseMessage, reserveMessage } from '@/lib/agents/usage';
import {
  bioWriterAgent,
  buildBioWriterPrompt,
  cleanBio,
  templateBio,
  type BioWriterInput,
} from '@/lib/agents/agents/bio-writer';

/** Shown with the starter bio when no AI provider could write one. */
const TEMPLATE_NOTICE =
  'Our bio writer is busy right now, so here is a simple starting point. Make it yours: say what you shoot, where you work and what clients can expect.';

/** Per provider attempt, so the whole failover chain fits in maxDuration. */
const ATTEMPT_TIMEOUT_MS = 15_000;

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

  let input: BioWriterInput | null = null;
  try {
    input = await loadBioInput(auth.user.id);

    // Through the gateway (lib/ai/resilient): the bio writer's own model
    // first, then the configured failover chain, so an Anthropic key that is
    // out of credit hands over to Gemini instead of failing the step. Cost is
    // recorded against the agent's model (an upper bound when a cheaper
    // fallback answered).
    const text = await trackedCompletion<string>({
      agentId: bioWriterAgent.id,
      provider: bioWriterAgent.provider,
      model: bioWriterAgent.model,
      userId: auth.user.id,
      call: async () => {
        const out = await generateWithFallback({
          ref: `${bioWriterAgent.provider}:${bioWriterAgent.model}`,
          prompt: buildBioWriterPrompt(input as BioWriterInput),
          temperature: 0.7,
          timeoutMs: ATTEMPT_TIMEOUT_MS,
        });
        if (out.servedBy !== bioWriterAgent.provider) {
          console.warn(`[agents/bio-writer] served by ${out.servedBy}/${out.modelId} after: ${out.attempts.map((a) => a.provider).join(', ')}`);
        }
        return { result: out.text, usage: out.usage };
      },
    });

    const bio = cleanBio(text);
    if (!bio) throw new Error('empty bio');
    return NextResponse.json({ bio, samples: input.topSceneTypes.length, source: 'ai' });
  } catch (err) {
    console.error('[agents/bio-writer] error:', err instanceof Error ? err.message : err);
    // No AI bio was produced: the slot is given back.
    try {
      await releaseMessage(supabase, slot);
    } catch (releaseErr) {
      console.error('[agents/bio-writer] usage release failed:', releaseErr);
    }
    if (input) {
      // Never an empty box: a plain starting bio the creator can edit.
      return NextResponse.json({
        bio: templateBio(input),
        samples: input.topSceneTypes.length,
        source: 'template',
        notice: TEMPLATE_NOTICE,
      });
    }
    return NextResponse.json(
      { error: 'We could not draft a bio just now. Write a line or two about what you shoot and where you work.' },
      { status: 503 },
    );
  }
}
