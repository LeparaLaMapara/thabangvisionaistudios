import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NAME_LOCKED_MESSAGE,
  isNameLocked,
  isVerifiedProfile,
  isWriteDenied,
  nameChanged,
  writeDeniedEvent,
} from '@/lib/supabase/write-denied';

const root = join(__dirname, '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

describe('write-denied helpers (migration 067)', () => {
  it('recognises a privilege refusal by SQLSTATE 42501 only', () => {
    expect(isWriteDenied({ code: '42501', message: 'permission denied for table profiles' })).toBe(true);
    expect(isWriteDenied({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isWriteDenied(null)).toBe(false);
  });

  it('tells the verified-name lock apart from other refusals', () => {
    expect(isNameLocked({ code: '42501', hint: 'tv_name_locked', message: NAME_LOCKED_MESSAGE })).toBe(true);
    expect(isNameLocked({ code: '42501', hint: 'tv_privileged_column', message: 'Permission denied: role' })).toBe(false);
    expect(isNameLocked({ code: 'P0001', hint: 'tv_name_locked' })).toBe(false);
  });

  it('treats either verification flag as verified', () => {
    expect(isVerifiedProfile({ verification_status: 'verified' })).toBe(true);
    expect(isVerifiedProfile({ is_verified: true, verification_status: 'pending' })).toBe(true);
    expect(isVerifiedProfile({ verification_status: 'rejected', is_verified: false })).toBe(false);
    expect(isVerifiedProfile(null)).toBe(false);
  });

  it('compares names ignoring surrounding whitespace', () => {
    expect(nameChanged('Thabo', ' Thabo ')).toBe(false);
    expect(nameChanged('Thabo', 'Thabang')).toBe(true);
    expect(nameChanged(null, '')).toBe(false);
  });

  it('logs refusals without personal data', () => {
    const event = writeDeniedEvent({
      userId: 'u1',
      route: 'POST /api/onboarding',
      table: 'profiles',
      error: { code: '42501', hint: 'tv_name_locked', message: 'Your name is locked … Thabo Mokoena' },
    });
    expect(event.eventType).toBe('security_write_denied');
    expect(event.metadata).toEqual({
      route: 'POST /api/onboarding',
      table: 'profiles',
      code: '42501',
      hint: 'tv_name_locked',
    });
    expect(JSON.stringify(event)).not.toContain('Thabo');
  });

  it('keeps the UI message identical to the database message', () => {
    expect(read('lib/migrations/067-lock-sensitive-columns.sql')).toContain(NAME_LOCKED_MESSAGE);
  });
});

describe('verification documents are server-written to unique paths', () => {
  const route = read('app/api/verifications/route.ts');

  it('never upserts (no overwrite of a checked document)', () => {
    expect(route).not.toMatch(/upsert:\s*true/);
    expect(route).toMatch(/upsert:\s*false/);
  });

  it('uploads with the service role to a random path inside the user folder', () => {
    expect(route).toContain('createAdminClient()');
    expect(route).toMatch(/\$\{user\.id\}\/\$\{crypto\.randomUUID\(\)\}-/);
    expect(route).toContain("'submit_verification_for_user'");
  });
});

describe('migration 067 shape', () => {
  const sql = read('lib/migrations/067-lock-sensitive-columns.sql');

  it('drops the storage overwrite policy and keeps the bucket private', () => {
    expect(sql).toContain('drop policy if exists "Users can update own verification docs" on storage.objects');
    expect(sql).toMatch(/update storage\.buckets set public = false where id = 'verifications'/);
  });

  it('revokes client writes before granting the allow-list back', () => {
    const revoke = sql.indexOf('revoke insert, update on public.profiles');
    const grant = sql.indexOf("grant update (%s) on public.profiles to authenticated");
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    for (const locked of ["'role'", "'is_verified'", "'id_document_hash'", "'selfie_with_id_path'", "'verification_status'"]) {
      const allowList = sql.slice(sql.indexOf('v_update_cols constant text[]'), sql.indexOf('v_present text;'));
      expect(allowList).not.toContain(locked);
    }
  });

  it('adds WITH CHECK to the reviews and banking UPDATE policies', () => {
    expect(sql).toMatch(/"Users can update own reviews"[\s\S]*?with check \(auth\.uid\(\) = reviewer_id\)/);
    expect(sql).toMatch(/"Users can update own banking details"[\s\S]*?with check \(auth\.uid\(\) = user_id\)/);
  });

  it('is wrapped in a transaction and documents a rollback', () => {
    expect(sql).toMatch(/^begin;$/m);
    expect(sql).toMatch(/^commit;$/m);
    expect(sql).toContain('-- ROLLBACK');
  });
});
