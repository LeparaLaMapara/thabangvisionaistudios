export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { checkRateLimit } from '@/lib/auth';
import { getModel } from '@/lib/ai';
import { createClient } from '@/lib/supabase/server';
import { buildSystemPrompt, fetchPlatformData, fetchUserContext } from '@/lib/ubunye/system-prompt';

// ─── Plan Limits ────────────────────────────────────────────────────────────

const PLAN_LIMITS: Record<string, number> = {
  free: 20,        // Free / Starter: 20 messages per day
  starter: 20,
  pro: 100,        // Pro Creator: 100 messages per day
  'pro-creator': 100,
  studio: -1,      // Studio: unlimited (-1 = no limit)
};

const GUEST_LIMIT = 5;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTodaySAST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

// ─── POST Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ── Parse body ──
  let prompt: string;
  let messages: { role: 'user' | 'assistant'; content: string }[] | undefined;
  let sessionMessageCount = 0;
  let isFirstGuestMessage = false;

  try {
    const body = await req.json();
    prompt = body.prompt;
    if (body.messages) messages = body.messages;
    if (typeof body.sessionMessageCount === 'number') sessionMessageCount = body.sessionMessageCount;
    if (body.isFirstGuestMessage === true) isFirstGuestMessage = true;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json(
      { error: '`prompt` is required and must be a non-empty string.' },
      { status: 400 },
    );
  }

  // ── Guest (unauthenticated) usage check ──
  if (!user) {
    const ip = req.headers.get('x-forwarded-for') ?? 'anonymous';
    const allowed = checkRateLimit(`ai-guest:${ip}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before trying again.' },
        { status: 429 },
      );
    }
    if (sessionMessageCount >= GUEST_LIMIT) {
      return NextResponse.json(
        { error: 'limit_reached', limit: GUEST_LIMIT, plan: 'guest' },
        { status: 429 },
      );
    }
  }

  // ── Authenticated usage check ──
  if (user) {
    const rateLimited = !checkRateLimit(`ai:${user.id}`, 10, 60_000);
    if (rateLimited) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before trying again.' },
        { status: 429 },
      );
    }

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*, subscription_plans(slug, name)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    const planSlug = (subscription?.subscription_plans as { slug?: string } | null)?.slug ?? 'free';
    const dailyLimit = PLAN_LIMITS[planSlug] ?? PLAN_LIMITS.free;

    if (dailyLimit !== -1) {
      const todaySAST = getTodaySAST();
      const { data: usage } = await supabase
        .from('ubunye_usage')
        .select('id, message_count')
        .eq('user_id', user.id)
        .eq('date', todaySAST)
        .single();

      const currentCount = usage?.message_count ?? 0;
      if (currentCount >= dailyLimit) {
        return NextResponse.json(
          { error: 'limit_reached', limit: dailyLimit, plan: planSlug },
          { status: 429 },
        );
      }

      if (usage) {
        await supabase.from('ubunye_usage').update({ message_count: currentCount + 1 }).eq('id', usage.id);
      } else {
        await supabase.from('ubunye_usage').insert({ user_id: user.id, date: todaySAST, message_count: 1 });
      }
    }
  }

  // ── Build context-aware system prompt ──
  const [platformData, userContext] = await Promise.all([
    fetchPlatformData(supabase),
    user ? fetchUserContext(supabase, user.id) : Promise.resolve(null),
  ]);

  let systemPrompt = buildSystemPrompt(platformData, userContext);

  // Enrich first guest message with intro instructions
  if (isFirstGuestMessage) {
    systemPrompt += `\n\nThis is the user's very first message. Introduce yourself warmly as Ubunye. Mention you can help with production planning, equipment, crew hiring, creative briefs, and SA industry pricing. Subtly mention they can sign in for more access. Be energetic and welcoming. Use their message as a springboard.`;
  }

  // Build message list
  const messageList = messages ?? [{ role: 'user' as const, content: prompt.trim() }];

  try {
    const result = await generateText({
      model: getModel(),
      system: systemPrompt,
      messages: messageList,
    });
    return NextResponse.json({ response: result.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[gemini] AI error:', message);
    return NextResponse.json(
      { error: 'AI service temporarily unavailable.' },
      { status: 502 },
    );
  }
}
