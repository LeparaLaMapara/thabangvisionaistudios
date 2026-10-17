import { createAdminClient } from '@/lib/supabase/server';
import { getFlag } from '@/lib/features';
import type { ProjectStore } from '@/lib/core/projects/use-cases';
import type { PlanNeed, PlanPart, ProjectRefKind } from '@/lib/core/projects/plan';

/**
 * Supabase adapter for plans (migration 097). Service role, because browsers
 * may only read their own plans; every method takes the client's id and the
 * database functions check ownership again (project_ref_owned,
 * project_create, project_link_item). Errors throw, so the use cases refuse
 * (fail closed).
 */

type Admin = ReturnType<typeof createAdminClient>;

export class SupabaseProjectStore implements ProjectStore {
  constructor(private db: Admin = createAdminClient()) {}

  async flagOn(): Promise<boolean> {
    return getFlag('ubunye_projects');
  }

  async ownsRef(clientId: string, kind: ProjectRefKind, refId: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('project_ref_owned', { p_client: clientId, p_kind: kind, p_ref: refId });
    if (error) throw new Error(`ownership check failed: ${error.message}`);
    return data === true;
  }

  async refInPlan(kind: ProjectRefKind, refId: string): Promise<boolean> {
    const { data, error } = await this.db.from('project_items').select('id').eq('kind', kind).eq('ref_id', refId).limit(1);
    if (error) throw new Error(`plan item lookup failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async create(p: { clientId: string; title: string; brief: object; conversationId: string | null; parts: PlanPart[] }): Promise<string> {
    const items = p.parts.map((part) => (part.kind === 'need' ? { kind: 'need', need: part.need } : { kind: part.kind, ref_id: part.ref_id }));
    const { data, error } = await this.db.rpc('project_create', {
      p_client: p.clientId,
      p_title: p.title,
      p_brief: p.brief,
      p_conversation: p.conversationId,
      p_items: items,
    });
    if (error || typeof data !== 'string') throw new Error(`plan create failed: ${error?.message ?? 'no id'}`);
    return data;
  }

  async link(p: { projectId: string; clientId: string; kind: ProjectRefKind; refId: string; replacesNeedId: string | null }): Promise<{ ok: true; itemId: string } | { ok: false; code: 'not_found' | 'not_owner' | 'other_plan' }> {
    const { data, error } = await this.db.rpc('project_link_item', {
      p_project: p.projectId,
      p_client: p.clientId,
      p_kind: p.kind,
      p_ref: p.refId,
      p_replaces: p.replacesNeedId,
    });
    if (error) {
      if (error.code === '23505') return { ok: false, code: 'other_plan' };
      if (error.code === '42501') return { ok: false, code: /plan not found/.test(error.message) ? 'not_found' : 'not_owner' };
      throw new Error(`plan link failed: ${error.message}`);
    }
    return { ok: true, itemId: String(data) };
  }

  async addNeed(p: { projectId: string; clientId: string; need: PlanNeed }): Promise<string | null> {
    const { data: plan, error } = await this.db.from('projects').select('id').eq('id', p.projectId).eq('client_id', p.clientId).eq('status', 'open').maybeSingle();
    if (error) throw new Error(`plan lookup failed: ${error.message}`);
    if (!plan) return null;
    const { data, error: insertError } = await this.db.from('project_items').insert({ project_id: p.projectId, kind: 'need', need: p.need }).select('id').single();
    if (insertError || !data) throw new Error(`need insert failed: ${insertError?.message ?? 'no row'}`);
    return (data as { id: string }).id;
  }

  async close(p: { projectId: string; clientId: string }): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('projects')
      .update({ status: 'closed', closed_at: now, updated_at: now })
      .eq('id', p.projectId)
      .eq('client_id', p.clientId)
      .eq('status', 'open')
      .select('id');
    if (error) throw new Error(`plan close failed: ${error.message}`);
    return (data ?? []).length === 1;
  }
}
