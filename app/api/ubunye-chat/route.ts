export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { executeAgent } from '@/lib/agents/runtime';
import { classifyIntent } from '@/lib/agents/router';

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
      const messages = body?.messages;
      if (Array.isArray(messages) && messages.length > 0) {
        // Find the last user message
        const lastUserMsg = [...messages].reverse().find(
          (m: { role: string }) => m.role === 'user',
        );
        if (lastUserMsg) {
          // Extract text content — could be string or parts array
          const text = typeof lastUserMsg.content === 'string'
            ? lastUserMsg.content
            : Array.isArray(lastUserMsg.content)
              ? lastUserMsg.content
                  .filter((p: { type: string }) => p.type === 'text')
                  .map((p: { text: string }) => p.text)
                  .join(' ')
              : '';
          if (text) {
            agentId = classifyIntent(text);
          }
        }
      } else if (typeof body?.prompt === 'string') {
        agentId = classifyIntent(body.prompt);
      }
    }
  } catch {
    // If we can't parse, fall through to assistant
  }

  return executeAgent(agentId, req);
}
