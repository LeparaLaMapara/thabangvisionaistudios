export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createConversation, hashIp } from '@/lib/data/chat-history';
import { clientIp } from '@/lib/http/clientIp';
import { checkRateLimit } from '@/lib/auth';
import { UBUNYE_AGENTS } from '@/lib/agents/registry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** New chats per hour, per account or (signed out) per network. */
const SESSIONS_PER_HOUR = 30;

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Same address derivation as the chat route, so the guest's conversation is recognised as theirs.
  const ip = clientIp(req.headers);
  if (!(await checkRateLimit(`chat-session:${user ? user.id : `ip:${ip}`}`, SESSIONS_PER_HOUR, 3_600_000))) {
    return NextResponse.json({ error: 'Too many new chats. Please wait a little.' }, { status: 429 });
  }

  let agentId = 'assistant';
  let metadata: Record<string, unknown> = {};

  try {
    const body = await req.json();
    // Only a known agent; anything else is the general assistant.
    if (typeof body.agent_id === 'string' && Object.hasOwn(UBUNYE_AGENTS, body.agent_id)) agentId = body.agent_id;
    if (typeof body.creator_id === 'string' && UUID.test(body.creator_id)) {
      agentId = 'booking';
      metadata = { pre_selected_creator: body.creator_id };
    }
  } catch {
    // Defaults are fine
  }

  const conversationId = await createConversation({
    userId: user?.id ?? null,
    agentId,
    guestIpHash: user ? undefined : hashIp(ip),
    metadata,
  });

  if (!conversationId) {
    return NextResponse.json(
      { error: 'Failed to create chat session.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation_id: conversationId });
}
