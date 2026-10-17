import { createAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChatConversationInsert {
  userId: string | null;
  agentId: string;
  guestIpHash?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessageInsert {
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  toolCalls?: { name: string; args_summary: Record<string, unknown>; result_summary?: string }[];
  entities?: { creators?: string[]; gear?: string[]; productions?: string[] };
  agentId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Blind card data to draw again on reload (lib/ubunye/chat-cards.ts; column from 097). */
  cards?: unknown[];
  /** Ids our tools returned this turn (column from 097), for propose_plan. */
  toolRefIds?: string[];
}

export interface ConversionUpdate {
  conversationId: string;
  convertedTo: 'booking' | 'rental_inquiry' | 'creator_view' | 'quote_request';
  convertedRef?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/**
 * Whether a conversation id sent by the browser belongs to this person (or,
 * for a guest, to this network address and no account). Fails closed: an
 * unknown id or a lookup error means "not theirs".
 */
export async function conversationBelongsTo(conversationId: string, userId: string | null, guestIpHash: string | null): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return false;
  try {
    const { data, error } = await createAdminClient()
      .from('chat_conversations')
      .select('user_id, guest_ip_hash')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !data) return false;
    const row = data as { user_id: string | null; guest_ip_hash: string | null };
    if (userId) return row.user_id === userId;
    return row.user_id === null && row.guest_ip_hash !== null && row.guest_ip_hash === guestIpHash;
  } catch {
    return false;
  }
}

// ─── Fire-and-forget loggers (following events.ts pattern) ─────────────────────

export function createConversation(data: ChatConversationInsert): Promise<string | null> {
  return _createConversation(data).catch((err) => {
    console.error('[chat-history] Failed to create conversation:', err);
    return null;
  });
}

export function logChatMessage(data: ChatMessageInsert): void {
  _insertMessage(data).catch((err) => {
    console.error('[chat-history] Failed to log message:', err);
  });
}

export function markConversion(data: ConversionUpdate): void {
  _updateConversion(data).catch((err) => {
    console.error('[chat-history] Failed to mark conversion:', err);
  });
}

export function endConversation(conversationId: string): void {
  _endConversation(conversationId).catch((err) => {
    console.error('[chat-history] Failed to end conversation:', err);
  });
}

// ─── Internal DB operations ────────────────────────────────────────────────────

async function _createConversation(data: ChatConversationInsert): Promise<string | null> {
  const supabase = createAdminClient();

  const { data: row, error } = await supabase
    .from('chat_conversations')
    .insert({
      user_id: data.userId,
      agent_id: data.agentId,
      guest_ip_hash: data.guestIpHash ?? null,
      metadata: data.metadata ?? {},
    })
    .select('id')
    .single();

  if (error) {
    console.error('[chat-history] Insert conversation error:', error.message);
    return null;
  }

  return row.id;
}

async function _insertMessage(data: ChatMessageInsert): Promise<void> {
  const supabase = createAdminClient();

  const row: Record<string, unknown> = {
    conversation_id: data.conversationId,
    role: data.role,
    content: data.content,
    tool_calls: data.toolCalls ?? null,
    entities: data.entities ?? null,
    agent_id: data.agentId ?? null,
    model: data.model ?? null,
    input_tokens: data.inputTokens ?? null,
    output_tokens: data.outputTokens ?? null,
  };
  // Only sent when there is something to keep, so a database without 097
  // (the columns) still logs every message.
  const extras: Record<string, unknown> = {};
  if (data.cards && data.cards.length) extras.cards = data.cards;
  if (data.toolRefIds && data.toolRefIds.length) extras.tool_ref_ids = data.toolRefIds;

  let { error } = await supabase.from('chat_messages').insert({ ...row, ...extras });
  if (error && Object.keys(extras).length) ({ error } = await supabase.from('chat_messages').insert(row));

  if (error) {
    console.error('[chat-history] Insert message error:', error.message);
  }
}

async function _updateConversion(data: ConversionUpdate): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('chat_conversations')
    .update({
      status: 'converted',
      converted_to: data.convertedTo,
      converted_ref: data.convertedRef ?? null,
    })
    .eq('id', data.conversationId);

  if (error) {
    console.error('[chat-history] Update conversion error:', error.message);
  }
}

async function _endConversation(conversationId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('chat_conversations')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .eq('status', 'active');

  if (error) {
    console.error('[chat-history] End conversation error:', error.message);
  }
}
