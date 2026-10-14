import type { SupabaseClient } from '@supabase/supabase-js';
import { getFlag } from '@/lib/features';
import type { ExpiredRow, IntakeRetentionStore } from './retention';

const BUCKET = 'role-documents';
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST204', '42703']);

/** The Supabase side of purgeExpiredIntake (service role). */
export class SupabaseIntakeRetention implements IntakeRetentionStore {
  constructor(private readonly db: SupabaseClient) {}

  enabled(): Promise<boolean> {
    return getFlag('roles_v1');
  }

  async expiredEvidence(cutoffIso: string, limit: number): Promise<ExpiredRow[] | null> {
    const { data, error } = await this.db
      .from('role_evidence')
      .select('id, storage_ref')
      .in('step_key', ['cv', 'voice'])
      .eq('kind', 'document')
      .eq('storage_provider', 'supabase')
      .lt('created_at', cutoffIso)
      .limit(limit);
    if (error) {
      if (MISSING.has(error.code ?? '')) return null;
      throw new Error(error.message);
    }
    return ((data ?? []) as ExpiredRow[]).filter((r) => typeof r.storage_ref === 'string');
  }

  async userFolders(limit: number): Promise<string[]> {
    const { data, error } = await this.db.storage.from(BUCKET).list('', { limit });
    if (error) return [];
    // Folders have no id; user folders are uuids.
    return (data ?? []).filter((o) => !o.id && /^[0-9a-f-]{36}$/i.test(o.name)).map((o) => o.name);
  }

  async intakeFiles(folder: string): Promise<{ name: string; created_at: string | null }[]> {
    const { data, error } = await this.db.storage.from(BUCKET).list(`${folder}/intake`, { limit: 100 });
    if (error) return [];
    return (data ?? []).filter((o) => !!o.id).map((o) => ({ name: o.name, created_at: o.created_at ?? null }));
  }

  async removeFiles(paths: string[]): Promise<number> {
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const { data, error } = await this.db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (error) throw new Error(error.message);
      removed += data?.length ?? 0;
    }
    return removed;
  }

  async deleteEvidence(ids: string[]): Promise<number> {
    const { error, count } = await this.db.from('role_evidence').delete({ count: 'exact' }).in('id', ids);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
