import { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChatConversation {
  id: string;
  user_id: string | null;
  agent_id: string;
  status: 'active' | 'ended' | 'converted';
  message_count: number;
  converted_to: string | null;
  converted_ref: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls: { name: string; args_summary: Record<string, unknown>; result_summary?: string }[] | null;
  entities: { creators?: string[]; gear?: string[]; productions?: string[] } | null;
  agent_id: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

// ─── Query Functions ───────────────────────────────────────────────────────────

export async function getUserConversations(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<ChatConversation[]> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[chatHistory] getUserConversations error:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[chatHistory] getConversationMessages error:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getConversationStats(
  supabase: SupabaseClient,
  days = 30,
): Promise<{
  totalConversations: number;
  totalMessages: number;
  conversionRate: number;
  topAgents: { agent_id: string; count: number }[];
}> {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [convos, converted] = await Promise.all([
    supabase
      .from('chat_conversations')
      .select('id, agent_id, converted_to', { count: 'exact' })
      .gte('started_at', since),
    supabase
      .from('chat_conversations')
      .select('id', { count: 'exact' })
      .gte('started_at', since)
      .not('converted_to', 'is', null),
  ]);

  const total = convos.count ?? 0;
  const convertedCount = converted.count ?? 0;

  const agentCounts: Record<string, number> = {};
  for (const c of convos.data ?? []) {
    agentCounts[c.agent_id] = (agentCounts[c.agent_id] ?? 0) + 1;
  }

  const topAgents = Object.entries(agentCounts)
    .map(([agent_id, count]) => ({ agent_id, count }))
    .sort((a, b) => b.count - a.count);

  const { count: msgCount } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);

  return {
    totalConversations: total,
    totalMessages: msgCount ?? 0,
    conversionRate: total > 0 ? convertedCount / total : 0,
    topAgents,
  };
}
