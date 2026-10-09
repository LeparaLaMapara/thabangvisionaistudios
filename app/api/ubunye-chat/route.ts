export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { executeAgent } from '@/lib/agents/runtime';
import { classifyIntent } from '@/lib/agents/router';
import { lastUserText } from '@/lib/agents/last-user-text';
import { createClient } from '@/lib/supabase/server';
import { SupabaseAgentActions } from '@/lib/agent/repo';
import { conversationBelongsTo } from '@/lib/data/chat-history';

// Unified chat endpoint — classifies intent from the last user message
// and routes to the appropriate agent (assistant, booking, portfolios, rates).
// The frontend continues to call /api/ubunye-chat for all conversations.
export async function POST(req: NextRequest): Promise<Response> {
  // Clone the request so we can peek at the body without consuming it
  const cloned = req.clone();

  let agentId = 'assistant';
  try {
    const body = await cloned.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : null;

    if (body?.creator_id) {
      // Pre-selected creator → always use booking agent
      agentId = 'booking';
    } else if (user && conversationId && (await conversationBelongsTo(conversationId, user.id, null))
      && (await new SupabaseAgentActions().pending(user.id, conversationId, new Date()))) {
      // A proposal is waiting: "yes", "change the dates", "cancel" belong to the booking flow.
      agentId = 'booking';
    } else {
      const text = lastUserText(body);
      if (text) agentId = classifyIntent(text);
    }
    // Signed-out visitors talk to the assistant (which explains how to sign in
    // to book) instead of being turned away by the booking agent.
    if (!user && agentId === 'booking' && !body?.creator_id) agentId = 'assistant';
  } catch {
    // If we can't parse, fall through to assistant
  }

  return executeAgent(agentId, req);
}
