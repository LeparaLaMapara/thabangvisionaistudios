export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { streamText, convertToModelMessages } from 'ai';
import { checkRateLimit } from '@/lib/auth';
import { getModel } from '@/lib/ai';
import { createClient } from '@/lib/supabase/server';
import { buildSystemPrompt, fetchPlatformData, fetchUserContext } from '@/lib/ubunye/system-prompt';

// ─── Plan Limits ────────────────────────────────────────────────────────────

const PLAN_LIMITS: Record<string, number> = {
  free: 20,
  starter: 20,
  pro: 100,
  'pro-creator': 100,
  studio: -1,
};

const GUEST_LIMIT = 5;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTodaySAST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

// ─── POST Handler (Streaming via Vercel AI SDK) ────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ── Parse body ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawMessages: any[];
  let sessionMessageCount = 0;
  let isFirstGuestMessage = false;

  try {
    const body = await req.json();

    // Support both Vercel AI SDK format (messages array) and legacy format (prompt string)
    if (body.messages && Array.isArray(body.messages)) {
      rawMessages = body.messages;
    } else if (body.prompt && typeof body.prompt === 'string' && body.prompt.trim()) {
      rawMessages = [{ role: 'user', content: body.prompt.trim() }];
    } else {
      return NextResponse.json(
        { error: '`messages` array or `prompt` string is required.' },
        { status: 400 },
      );
    }

    if (typeof body.sessionMessageCount === 'number') sessionMessageCount = body.sessionMessageCount;
    if (body.isFirstGuestMessage === true) isFirstGuestMessage = true;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
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

  if (isFirstGuestMessage) {
    systemPrompt += `\n\nThis is the user's very first message. Introduce yourself warmly as Ubunye. Mention you can help with production planning, equipment, crew hiring, creative briefs, and SA industry pricing. Subtly mention they can sign in for more access. Be energetic and welcoming. Use their message as a springboard.`;
  }

  try {
    // Convert UIMessage[] (from useChat frontend) or CoreMessage[] (from curl) to ModelMessage[]
    const isUIFormat = rawMessages.some((m: { parts?: unknown }) => Array.isArray(m.parts));
    const modelMessages = isUIFormat
      ? await convertToModelMessages(rawMessages)
      : rawMessages;

    const result = streamText({
      model: getModel(),
      system: systemPrompt,
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ubunye-chat] AI error:', message);
    return NextResponse.json(
      { error: 'AI service temporarily unavailable.' },
      { status: 502 },
    );
  }
}
