import { createAdminClient } from '@/lib/supabase/server';
import type { AgentActionKind, AgentActionState } from '@/lib/core/agent/approval';
import type { AgentActionRecord, AgentActionRepository, ApprovalSummary } from '@/lib/core/agent/use-cases';

type Admin = ReturnType<typeof createAdminClient>;

interface Row {
  id: string;
  user_id: string;
  conversation_id: string | null;
  kind: AgentActionKind;
  state: AgentActionState;
  amount_cents: number;
  quote_version: number;
  payload: Record<string, unknown>;
  summary: ApprovalSummary;
  nonce_hash: string;
  expires_at: string;
}

const COLUMNS = 'id, user_id, conversation_id, kind, state, amount_cents, quote_version, payload, summary, nonce_hash, expires_at';

function toRecord(r: Row): AgentActionRecord {
  return {
    id: r.id,
    userId: r.user_id,
    conversationId: r.conversation_id,
    kind: r.kind,
    state: r.state,
    amountCents: r.amount_cents,
    quoteVersion: r.quote_version,
    payload: r.payload,
    summary: r.summary,
    nonceHash: r.nonce_hash,
    expiresAt: r.expires_at,
  };
}

/** Supabase adapter for prepared Ubunye actions (migration 074). Service role only. */
export class SupabaseAgentActions implements AgentActionRepository {
  constructor(private db: Admin = createAdminClient()) {}

  async insertPrepared(a: Omit<AgentActionRecord, 'state'>): Promise<void> {
    const { error } = await this.db.from('agent_actions').insert({
      id: a.id,
      user_id: a.userId,
      conversation_id: a.conversationId,
      kind: a.kind,
      amount_cents: a.amountCents,
      quote_version: a.quoteVersion,
      payload: a.payload,
      summary: a.summary,
      nonce_hash: a.nonceHash,
      expires_at: a.expiresAt,
    });
    if (error) throw new Error(`agent action insert failed: ${error.message}`);
  }

  async get(id: string): Promise<AgentActionRecord | null> {
    const { data, error } = await this.db.from('agent_actions').select(COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new Error(`agent action lookup failed: ${error.message}`);
    return data ? toRecord(data as Row) : null;
  }

  async pending(userId: string, conversationId: string | null, now: Date): Promise<AgentActionRecord | null> {
    let q = this.db.from('agent_actions').select(COLUMNS).eq('user_id', userId).eq('state', 'prepared').gt('expires_at', now.toISOString());
    q = conversationId ? q.eq('conversation_id', conversationId) : q.is('conversation_id', null);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(1);
    if (error) throw new Error(`pending agent action lookup failed: ${error.message}`);
    const row = (data ?? [])[0] as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async rotateNonce(id: string, userId: string, nonceHash: string, now: Date): Promise<boolean> {
    const { data, error } = await this.db
      .from('agent_actions')
      .update({ nonce_hash: nonceHash, updated_at: now.toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('state', 'prepared')
      .gt('expires_at', now.toISOString())
      .select('id');
    if (error) throw new Error(`agent action token rotation failed: ${error.message}`);
    return (data ?? []).length === 1;
  }

  async claim(id: string, userId: string, nonceHash: string, now: Date): Promise<boolean> {
    const { data, error } = await this.db
      .from('agent_actions')
      .update({ state: 'committing', updated_at: now.toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('state', 'prepared')
      .eq('nonce_hash', nonceHash)
      .gt('expires_at', now.toISOString())
      .select('id');
    if (error) throw new Error(`agent action claim failed: ${error.message}`);
    return (data ?? []).length === 1;
  }

  async finish(id: string, state: 'committed' | 'failed' | 'cancelled', result: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    // committed/failed only from committing; cancelled only from prepared.
    const from = state === 'cancelled' ? ['prepared'] : ['committing'];
    const { error } = await this.db
      .from('agent_actions')
      .update({ state, result, updated_at: now, ...(state === 'committed' ? { committed_at: now } : {}) })
      .eq('id', id)
      .in('state', from);
    if (error) throw new Error(`agent action finish failed: ${error.message}`);
  }
}
