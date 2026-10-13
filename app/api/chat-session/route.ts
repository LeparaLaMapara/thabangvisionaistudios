export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createConversation, hashIp } from '@/lib/data/chat-history';
import { clientIp } from '@/lib/http/clientIp';

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let agentId = 'assistant';
  let metadata: Record<string, unknown> = {};

  try {
    const body = await req.json();
    if (typeof body.agent_id === 'string') agentId = body.agent_id;
    if (typeof body.creator_id === 'string' && body.creator_id) {
      agentId = 'booking';
      metadata = { pre_selected_creator: body.creator_id };
    }
  } catch {
    // Defaults are fine
  }

  // Same address derivation as the chat route, so the guest's conversation is recognised as theirs.
  const ip = clientIp(req.headers);

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
