import { ROLES_POLICY } from '@/lib/constants';

/**
 * CV and voice-note retention (TASK-085, docs/processes/roles-and-proof.md
 * "CV retention"). Run once a day by /api/cron/daily-maintenance.
 *
 * The private originals (a CV, a voice note) are deleted
 * ROLES_POLICY.cvRetentionDays after upload, both the storage object and the
 * evidence row that points at it. The reviewed facts read from them stay on
 * person_roles. Legal documents (licence, disc, ID) and face photos are never
 * touched here.
 *
 * Also removes CV and audio uploads that were never filed (the person left
 * on screen 2), found under <user>/intake/ by their name ("cv-..." or
 * "audio-...").
 *
 * Safe everywhere: a no-op while roles_v1 is off or before migration 091;
 * idempotent (a deleted row or file is simply not found again); bounded per
 * run; logs counts only, never names or paths.
 */

export interface ExpiredRow {
  id: string;
  storage_ref: string;
}

export interface IntakeRetentionStore {
  /** roles_v1 is on. */
  enabled(): Promise<boolean>;
  /** CV and voice evidence rows in private storage created before the cutoff; null when the tables do not exist. */
  expiredEvidence(cutoffIso: string, limit: number): Promise<ExpiredRow[] | null>;
  /** User folders in the private bucket (bounded). */
  userFolders(limit: number): Promise<string[]>;
  /** Files directly under <folder>/intake with their upload time. */
  intakeFiles(folder: string): Promise<{ name: string; created_at: string | null }[]>;
  removeFiles(paths: string[]): Promise<number>;
  deleteEvidence(ids: string[]): Promise<number>;
}

export interface RetentionResult {
  skipped?: 'roles_v1 off' | 'tables missing';
  filesRemoved: number;
  rowsRemoved: number;
  strayFilesRemoved: number;
}

/** Only CV and voice/audio uploads are retention-limited; legal photos are not. */
export function isRetainedKind(fileName: string): boolean {
  return /^(cv|audio)-[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(fileName);
}

export function retentionCutoff(now: Date, days: number = ROLES_POLICY.cvRetentionDays): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export function isPastRetention(createdAt: string | null, cutoff: Date): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t < cutoff.getTime();
}

const ROW_BATCH = 200;
const MAX_FOLDERS = 200;

export async function purgeExpiredIntake(store: IntakeRetentionStore, now: Date): Promise<RetentionResult> {
  const result: RetentionResult = { filesRemoved: 0, rowsRemoved: 0, strayFilesRemoved: 0 };
  if (!(await store.enabled())) return { ...result, skipped: 'roles_v1 off' };

  const cutoff = retentionCutoff(now);
  const rows = await store.expiredEvidence(cutoff.toISOString(), ROW_BATCH);
  if (rows === null) return { ...result, skipped: 'tables missing' };

  if (rows.length) {
    // Files first: if removing a file fails, the row stays and the next run tries again.
    const paths = rows.map((r) => r.storage_ref).filter((p) => p && !p.startsWith('/'));
    result.filesRemoved = paths.length ? await store.removeFiles(paths) : 0;
    result.rowsRemoved = await store.deleteEvidence(rows.map((r) => r.id));
  }

  // Uploads never filed as evidence.
  const stray: string[] = [];
  for (const folder of await store.userFolders(MAX_FOLDERS)) {
    for (const f of await store.intakeFiles(folder)) {
      if (isRetainedKind(f.name) && isPastRetention(f.created_at, cutoff)) stray.push(`${folder}/intake/${f.name}`);
    }
  }
  if (stray.length) result.strayFilesRemoved = await store.removeFiles(stray);

  return result;
}
