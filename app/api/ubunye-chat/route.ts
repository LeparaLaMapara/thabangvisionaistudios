export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { executeAgent } from '@/lib/agents/runtime';
import { classifyIntent } from '@/lib/agents/router';
import { lastUserText } from '@/lib/agents/last-user-text';

// Unified chat endpoint — classifies intent from the last user message
// and routes to the appropriate agent (assistant, booking, portfolios, rates).
// The frontend continues to call /api/ubunye-chat for all conversations.
export async function POST(req: NextRequest): Promise<Response> {
  // Clone the request so we can peek at the body without consuming it
  const cloned = req.clone();

  let agentId = 'assistant';
  try {
    const body = await cloned.json();

    // Pre-selected creator → always use booking agent
    if (body?.creator_id) {
      agentId = 'booking';
    } else {
      const text = lastUserText(body);
      if (text) agentId = classifyIntent(text);
    }
  } catch {
    // If we can't parse, fall through to assistant
  }

  return executeAgent(agentId, req);
}
