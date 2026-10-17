export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { conversationBelongsTo } from '@/lib/data/chat-history';
import { getFlag } from '@/lib/features';
import { STUDIO } from '@/lib/constants';
import { readCards } from '@/lib/ubunye/chat-cards';

/**
 * A signed-in person's own chat, to show again (the plan page links back to
 * the chat it came from). Text plus the blind card data stored with each
 * reply (lib/ubunye/chat-cards.ts), checked again on the way out. Someone
 * else's conversation, or an unknown id, is "not found". Plans flag only.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getFlag('ubunye_projects'))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  if (!(await checkRateLimit(`chat-history:${auth.user.id}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Wait a minute.' }, { status: 429 });
  }
  const { id } = await params;
  if (!(await conversationBelongsTo(id, auth.user.id, null))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  try {
    const { data, error } = await createAdminClient()
      .from('chat_messages')
      .select('id, role, content, cards, created_at')
      .eq('conversation_id', id)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(STUDIO.security.chat.maxHistoryMessages);
    if (error) throw new Error(error.message);
    const messages = ((data ?? []) as { id: string; role: 'user' | 'assistant'; content: string | null; cards: unknown }[])
      .reverse()
      .map((m) => ({ id: m.id, role: m.role, text: m.content ?? '', cards: m.role === 'assistant' ? readCards(m.cards) : [] }))
      .filter((m) => m.text || m.cards.length);
    return NextResponse.json({ conversation_id: id, messages }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not load this chat just now.' }, { status: 503 });
  }
}
