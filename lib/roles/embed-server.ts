import { createAdminClient } from '@/lib/supabase/server';
import { getFlag } from '@/lib/features';
import { embedding as embeddingProvider, generateEmbedding } from '@/lib/rag/embeddings';
import { getRoles, loadRecords, PERSON_ROLE_COLUMNS } from '@/lib/supabase/queries/roles';
import { buildProfileDocument, documentHash } from './document';
import { sanitizeFacts } from './facts';
import { blindLabel } from './blind';
import { parseComesWith } from './profile';
import { rankMatches, type RankedMatch } from './ranking';
import type { PersonRole } from './types';

/**
 * Profile embeddings (migration 091). One vector per role profile, from the
 * competence-only profile document (lib/roles/document.ts). Re-embedded
 * whenever the facts or the record change: call reembedPersonRole() after
 * facts are saved, after an approval, a vouch, a review or a completed job.
 * An unchanged document is skipped (same hash).
 */

const MODEL_NAME = 'gemini-embedding-2';

export async function reembedPersonRole(personRoleId: string): Promise<'embedded' | 'unchanged' | 'skipped'> {
  if (!embeddingProvider.isConfigured() || embeddingProvider.dimensions !== 768) return 'skipped';
  const admin = createAdminClient();
  const { data } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).eq('id', personRoleId).maybeSingle();
  if (!data) return 'skipped';
  const pr = data as unknown as PersonRole;
  const [roles, records] = await Promise.all([getRoles(), loadRecords([pr])]);
  const role = roles.find((r) => r.slug === pr.role_slug);
  const record = records.get(pr.id);
  if (!role || !record) return 'skipped';

  const doc = buildProfileDocument({
    roleName: role.name,
    headline: pr.headline,
    about: pr.about,
    area: pr.area,
    facts: sanitizeFacts(pr.facts),
    comesWith: parseComesWith(pr.comes_with)?.label ?? null,
    record,
  });
  const hash = documentHash(doc);
  const { data: existing } = await admin.from('person_role_embeddings').select('document_hash').eq('person_role_id', pr.id).maybeSingle();
  if (existing?.document_hash === hash) return 'unchanged';

  const vector = await generateEmbedding(doc);
  if (!vector) return 'skipped';
  const { error } = await admin.from('person_role_embeddings').upsert({
    person_role_id: pr.id,
    embedding: JSON.stringify(vector),
    model: embeddingProvider.name === 'gemini' ? MODEL_NAME : embeddingProvider.name,
    dims: vector.length,
    document_hash: hash,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return 'embedded';
}

/** Never fails the caller: embeddings are a background improvement. */
export async function reembedQuietly(personRoleId: string): Promise<void> {
  try {
    await reembedPersonRole(personRoleId);
  } catch {
    console.error('[roles/embed] re-embed failed');
  }
}

export async function reembedAllApproved(): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const { data } = await admin.from('person_roles').select('id').eq('status', 'approved');
  const counts: Record<string, number> = { embedded: 0, unchanged: 0, skipped: 0 };
  for (const row of data ?? []) {
    const r = await reembedPersonRole(row.id as string);
    counts[r] += 1;
  }
  return counts;
}

export interface MatchResultRow extends RankedMatch {
  label: string;
  roleSlug: string;
}

/** Similarity search ranked with the record and the fair "new" slots. Admin/dev only. */
export async function matchPeople(query: string, opts: { role?: string | null; limit?: number } = {}): Promise<MatchResultRow[]> {
  const vector = await generateEmbedding(query);
  if (!vector) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('match_person_roles', { p_query: JSON.stringify(vector), p_role: opts.role ?? null, p_limit: 50 });
  if (error) throw new Error(error.message);
  const hits = (data ?? []) as { person_role_id: string; similarity: number }[];
  if (!hits.length) return [];
  const { data: prs } = await admin.from('person_roles').select(PERSON_ROLE_COLUMNS).in('id', hits.map((h) => h.person_role_id));
  const rows = (prs ?? []) as unknown as PersonRole[];
  const [roles, records] = await Promise.all([getRoles(), loadRecords(rows)]);
  const ranked = rankMatches(
    rows.map((pr) => ({
      id: pr.id,
      similarity: hits.find((h) => h.person_role_id === pr.id)?.similarity ?? 0,
      record: records.get(pr.id) ?? { jobs: 0, onTime: 0, rebooked: 0, reviewCount: 0, averageRating: 0, vouches: 0, bookedCredits: [] },
      area: pr.area,
      available: true,
    })),
    { areaWords: query.split(/[^a-zA-Z]+/), limit: opts.limit },
  );
  return ranked.map((m) => {
    const pr = rows.find((r) => r.id === m.id) as PersonRole;
    const role = roles.find((r) => r.slug === pr.role_slug);
    return { ...m, roleSlug: pr.role_slug, label: blindLabel(role?.name ?? pr.role_slug, pr.area) };
  });
}

/**
 * Daily (daily-maintenance step 17c): embed approved profiles that have no
 * embedding yet, for example one an admin script approved
 * (scripts/roles/owner-portfolio.sql). No-op while roles_v1 is off or before
 * 091. Counts only.
 */
export async function reembedMissing(limit = 25): Promise<Record<string, number | string>> {
  if (!(await getFlag('roles_v1'))) return { skipped: 'roles_v1 off' };
  const admin = createAdminClient();
  const [{ data: approved, error }, { data: embedded }] = await Promise.all([
    admin.from('person_roles').select('id').eq('status', 'approved').limit(500),
    admin.from('person_role_embeddings').select('person_role_id').limit(1000),
  ]);
  if (error) return { skipped: 'tables missing' };
  const have = new Set((embedded ?? []).map((r) => r.person_role_id as string));
  const todo = (approved ?? []).map((r) => r.id as string).filter((id) => !have.has(id)).slice(0, limit);
  const counts: Record<string, number> = { embedded: 0, unchanged: 0, skipped: 0 };
  for (const id of todo) counts[await reembedPersonRole(id)] += 1;
  return counts;
}
