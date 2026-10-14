import { describe, it, expect } from 'vitest';
import { isPastRetention, isRetainedKind, purgeExpiredIntake, retentionCutoff, type ExpiredRow, type IntakeRetentionStore } from '@/lib/roles/retention';

const NOW = new Date('2026-10-14T00:00:00Z');
const OLD = '2026-06-01T00:00:00Z';
const NEW = '2026-10-01T00:00:00Z';
const U = '00000000-0000-4000-8000-000000000001';
const cv = (n: string) => `cv-00000000-0000-4000-8000-00000000000${n}.pdf`;

function fakeStore(opts: { enabled?: boolean; rows?: ExpiredRow[] | null; files?: { name: string; created_at: string | null }[] } = {}) {
  const calls = { removed: [] as string[], deletedIds: [] as string[] };
  let rows = opts.rows === undefined ? [] : opts.rows;
  let files = opts.files ?? [];
  const store: IntakeRetentionStore = {
    enabled: async () => opts.enabled ?? true,
    expiredEvidence: async () => rows,
    userFolders: async () => [U],
    intakeFiles: async () => files,
    removeFiles: async (paths) => {
      calls.removed.push(...paths);
      files = files.filter((f) => !paths.includes(`${U}/intake/${f.name}`));
      return paths.length;
    },
    deleteEvidence: async (ids) => {
      calls.deletedIds.push(...ids);
      rows = (rows ?? []).filter((r) => !ids.includes(r.id));
      return ids.length;
    },
  };
  return { store, calls };
}

describe('CV and voice retention', () => {
  it('does nothing while roles_v1 is off', async () => {
    const { store, calls } = fakeStore({ enabled: false, rows: [{ id: 'a', storage_ref: `${U}/intake/${cv('1')}` }] });
    expect(await purgeExpiredIntake(store, NOW)).toMatchObject({ skipped: 'roles_v1 off', filesRemoved: 0, rowsRemoved: 0 });
    expect(calls.removed).toEqual([]);
  });

  it('does nothing before migration 091 (tables missing)', async () => {
    const { store, calls } = fakeStore({ rows: null });
    expect(await purgeExpiredIntake(store, NOW)).toMatchObject({ skipped: 'tables missing' });
    expect(calls.removed).toEqual([]);
  });

  it('removes expired files and their rows, then stray uploads, and is idempotent', async () => {
    const { store, calls } = fakeStore({
      rows: [{ id: 'row1', storage_ref: `${U}/intake/${cv('1')}` }, { id: 'demo', storage_ref: '/roles/demo/x.pdf' }],
      files: [
        { name: cv('2'), created_at: OLD },
        { name: 'audio-00000000-0000-4000-8000-000000000003.m4a', created_at: OLD },
        { name: cv('4'), created_at: NEW },
        { name: 'legal-00000000-0000-4000-8000-000000000005.jpg', created_at: OLD },
      ],
    });
    const first = await purgeExpiredIntake(store, NOW);
    expect(first).toEqual({ filesRemoved: 1, rowsRemoved: 2, strayFilesRemoved: 2 });
    expect(calls.removed).not.toContain('/roles/demo/x.pdf');
    expect(calls.removed.some((p) => p.includes('legal-'))).toBe(false); // legal photos are never touched
    expect(calls.removed.some((p) => p.includes(cv('4')))).toBe(false); // too new
    const second = await purgeExpiredIntake(store, NOW);
    expect(second).toEqual({ filesRemoved: 0, rowsRemoved: 0, strayFilesRemoved: 0 });
  });

  it('only CV and audio uploads are retention-limited; the cutoff is 90 days', () => {
    expect(isRetainedKind(cv('1'))).toBe(true);
    expect(isRetainedKind('legal-00000000-0000-4000-8000-000000000005.jpg')).toBe(false);
    expect(isRetainedKind('face.jpg')).toBe(false);
    const cutoff = retentionCutoff(NOW);
    expect(cutoff.toISOString()).toBe('2026-07-16T00:00:00.000Z');
    expect(isPastRetention(OLD, cutoff)).toBe(true);
    expect(isPastRetention(NEW, cutoff)).toBe(false);
    expect(isPastRetention(null, cutoff)).toBe(false);
  });

  it('the result holds counts only, never names or paths', async () => {
    const { store } = fakeStore({ rows: [{ id: 'row1', storage_ref: `${U}/intake/${cv('1')}` }] });
    const r = await purgeExpiredIntake(store, NOW);
    expect(JSON.stringify(r)).not.toMatch(/intake|cv-|0000/);
  });
});
