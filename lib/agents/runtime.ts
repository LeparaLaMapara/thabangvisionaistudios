export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { checkRateLimit } from '@/lib/auth';
import { getModel, getModelId, routeQuery } from '@/lib/ai';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { fetchPlatformData, fetchUserContext, type UbunyeFlagsSnapshot } from '@/lib/ubunye/system-prompt';
import { getFlags } from '@/lib/features';
import { STUDIO } from '@/lib/constants';
import { isRagEnabled, searchSimilar, formatRetrievalContext } from '@/lib/rag';
import { UBUNYE_AGENTS } from '@/lib/agents/registry';
import { createSearchTools } from '@/lib/agents/tools/search';
import { createBookingTools } from '@/lib/agents/tools/booking';
import { buildAssistantPrompt } from '@/lib/agents/agents/assistant';
import { buildBookingPrompt } from '@/lib/agents/agents/booking';

// ─── Plan Limits ────────────────────────────────────────────────────────────

const PLAN_LIMITS: Record<string, number> = {
  free: 20,
  starter: 20,
  pro: 100,
  'pro-creator': 100,
  studio: -1,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTodaySAST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

/**
 * Resolve the daily limit for a given agent and plan.
 * Uses the agent's rateLimit config, falling back to PLAN_LIMITS.
 */
function resolveLimit(
  agentId: string,
  planSlug: string,
  isGuest: boolean,
): number {
  const agent = UBUNYE_AGENTS[agentId];
  if (!agent) return PLAN_LIMITS.free;

  if (isGuest) return agent.rateLimit.guest;

  switch (planSlug) {
    case 'studio':
      return agent.rateLimit.studio;
    case 'pro':
    case 'pro-creator':
      return agent.rateLimit.pro;
    default:
      return agent.rateLimit.free;
  }
}

// ─── Agent Tool Factory ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getToolsForAgent(agentId: string, supabase: any, isAuthenticated: boolean, flags: UbunyeFlagsSnapshot, hasPreSelectedCreator = false): Record<string, any> {
  switch (agentId) {
    case 'assistant':
      return createSearchTools(supabase, flags);
    case 'booking': {
      const tools = createBookingTools(supabase, isAuthenticated, flags);
      // Remove search tools when creator is already selected — no searching needed
      if (hasPreSelectedCreator) {
        delete tools.search_creators;
        delete tools.get_creator_detail;
      }
      return tools;
    }
    default:
      return {};
  }
}

// ─── System Prompt Builder per Agent ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildPromptForAgent(
  agentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string | null,
  isFirstGuestMessage: boolean,
  flags: UbunyeFlagsSnapshot,
): Promise<string> {
  const [platformData, userContext] = await Promise.all([
    fetchPlatformData(supabase, flags),
    userId ? fetchUserContext(supabase, userId) : Promise.resolve(null),
  ]);

  let systemPrompt: string;

  switch (agentId) {
    case 'assistant':
      systemPrompt = buildAssistantPrompt(platformData, userContext, flags);
      break;
    case 'booking':
      systemPrompt = buildBookingPrompt(platformData, userContext, flags);
      break;
    default:
      // Fallback: use the base system prompt from ubunye module
      const { buildSystemPrompt } = await import('@/lib/ubunye/system-prompt');
      systemPrompt = buildSystemPrompt(platformData, userContext, flags);
      break;
  }

  if (isFirstGuestMessage) {
    systemPrompt += `\n\nThis is the user's very first message. Introduce yourself warmly as Ubunye. Mention you can help with production planning, equipment, crew hiring, creative briefs, and SA industry pricing. Subtly mention they can sign in for more access. Be energetic and welcoming. Use their message as a springboard.`;
  }

  return systemPrompt;
}

// ─── Execute Agent (Shared Pipeline) ────────────────────────────────────────

/**
 * Shared agent execution pipeline:
 * auth -> rate limit -> build prompt -> select model -> execute with tools -> track cost -> stream
 */
export async function executeAgent(
  agentId: string,
  req: NextRequest,
): Promise<Response> {
  const agent = UBUNYE_AGENTS[agentId];
  if (!agent) {
    return NextResponse.json(
      { error: `Unknown agent: ${agentId}` },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ── Parse body ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawMessages: any[];
  let sessionMessageCount = 0;
  let isFirstGuestMessage = false;
  let preSelectedCreatorId: string | null = null;

  try {
    const body = await req.json();

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
    if (typeof body.creator_id === 'string' && body.creator_id) preSelectedCreatorId = body.creator_id;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // ── Guest (unauthenticated) usage check ──
  if (!user) {
    const guestLimit = resolveLimit(agentId, 'guest', true);

    // Booking agent requires authentication
    if (guestLimit === 0) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to use this feature.', redirect: '/login' },
        { status: 401 },
      );
    }

    const ip = req.headers.get('x-forwarded-for') ?? 'anonymous';
    const allowed = checkRateLimit(`ai-guest:${agentId}:${ip}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before trying again.' },
        { status: 429 },
      );
    }
    if (sessionMessageCount >= guestLimit) {
      return NextResponse.json(
        { error: 'limit_reached', limit: guestLimit, plan: 'guest' },
        { status: 429 },
      );
    }
  }

  // ── Authenticated usage check ──
  if (user) {
    const rateLimited = !checkRateLimit(`ai:${agentId}:${user.id}`, 10, 60_000);
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
    const dailyLimit = resolveLimit(agentId, planSlug, false);

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

  // ── Fetch feature flags (shared for prompt + tools) ──
  const flagsState = await getFlags(['smart_productions']);
  const flags: UbunyeFlagsSnapshot = { smart_productions: flagsState.smart_productions };

  // ── Build context-aware system prompt ──
  let systemPrompt = await buildPromptForAgent(agentId, supabase, user?.id ?? null, isFirstGuestMessage, flags);

  // ── Pre-selected creator context (from "Book Now" on creator page) ──
  if (preSelectedCreatorId) {
    const adminClient = createAdminClient();
    const { data: preCreator } = await adminClient
      .from('profiles')
      .select('id, display_name, crew_slug, specializations, hourly_rate, location, years_experience')
      .eq('id', preSelectedCreatorId)
      .eq('verification_status', 'verified')
      .single();

    if (preCreator) {
      systemPrompt += `\n\n===== PRE-SELECTED CREATOR =====
The client selected this creator from their work on smart-production. Creator and category are ALREADY KNOWN.
Do NOT call search_creators. Do NOT ask "any specific creator?" or "what type of shoot?"
Creator: ${preCreator.display_name} (ID: ${preCreator.id}, slug: ${preCreator.crew_slug})
Specializations: ${(preCreator.specializations ?? []).join(', ')}
Rate: R${preCreator.hourly_rate ?? 0}/hr | Location: ${preCreator.location ?? 'SA'} | Experience: ${preCreator.years_experience ?? 0} years
Only ask: how many hours, when, and where. Then quote and book.`;
    }
  }

  // ── RAG: retrieve relevant context from vector store ──
  if (isRagEnabled()) {
    const lastUserMsg = [...rawMessages].reverse().find(
      (m: { role: string }) => m.role === 'user',
    );
    const queryText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.parts)
        ? lastUserMsg.parts.filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join(' ')
        : '';

    if (queryText) {
      try {
        const adminClient = createAdminClient();
        const ragResults = await searchSimilar(adminClient, queryText, { limit: 5, threshold: 0.5 });
        const ragContext = formatRetrievalContext(ragResults);
        if (ragContext) {
          systemPrompt += `\n\n${ragContext}`;
        }
      } catch (err) {
        console.error(`[agent:${agentId}] RAG retrieval error:`, err instanceof Error ? err.message : err);
      }
    }
  }

  try {
    // Convert UIMessage[] (from useChat frontend) or CoreMessage[] (from curl) to ModelMessage[]
    const isUIFormat = rawMessages.some((m: { parts?: unknown }) => Array.isArray(m.parts));
    const modelMessages = isUIFormat
      ? await convertToModelMessages(rawMessages)
      : rawMessages;

    const tools = getToolsForAgent(agentId, supabase, !!user, flags, !!preSelectedCreatorId);

    // Route to model based on agent config and query complexity
    const lastUserText = [...rawMessages].reverse().find(
      (m: { role: string }) => m.role === 'user',
    );
    const queryText = typeof lastUserText?.content === 'string'
      ? lastUserText.content
      : '';

    // Booking agent always uses Claude Sonnet; assistant uses routeQuery
    let routedModel;
    let modelId: string;

    if (agentId === 'booking') {
      routedModel = getModel();
      modelId = getModelId();
    } else {
      const route = routeQuery(queryText);
      routedModel = route.model;
      modelId = route.modelId;

      if (route.tier === 'fast') {
        console.log(`[agent:${agentId}] Routed to ${modelId} (fast tier)`);
      }
    }

    const result = streamText({
      model: routedModel,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(4),
      onFinish: ({ totalUsage }) => {
        // Fire-and-forget token usage logging
        const inputTokens = totalUsage.inputTokens ?? 0;
        const outputTokens = totalUsage.outputTokens ?? 0;
        const total = inputTokens + outputTokens;

        if (total > 0) {
          const pricing = STUDIO.ai.pricing[modelId];
          const inputCost = pricing ? (inputTokens / 1_000_000) * pricing.input : 0;
          const outputCost = pricing ? (outputTokens / 1_000_000) * pricing.output : 0;

          const adminClient = createAdminClient();
          adminClient.from('ai_token_usage').insert({
            user_id: user?.id ?? null,
            model: modelId,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: total,
            estimated_cost: inputCost + outputCost,
          }).then(({ error }: { error: { message: string } | null }) => {
            if (error) console.error('[ai-usage] Insert error:', error.message);
          });
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[agent:${agentId}] AI error:`, message);
    return NextResponse.json(
      { error: 'AI service temporarily unavailable.' },
      { status: 502 },
    );
  }
}
