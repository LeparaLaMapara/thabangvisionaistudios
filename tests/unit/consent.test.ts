import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STUDIO } from '@/lib/constants';
import {
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  PURPOSES_BY_SOURCE,
  ConsentStoreUnavailableError,
  checkConsents,
  currentVersion,
  formatDocumentDate,
  hasCurrentConsent,
  hashConsentIp,
  recordConsent,
  requiredConsents,
  validateConsentRequest,
} from '@/lib/consent';

// ─── A tiny fake of the supabase query builder ──────────────────────────────

interface Row { user_id: string; consent_purpose: string; document_version: string; withdrawn_at: string | null; accepted_at: string }

function fakeDb(opts: { rows?: Row[]; selectError?: { code?: string; message: string }; insertError?: { code?: string; message: string } } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from() {
      const filters: Record<string, string> = {};
      const q = {
        select() { return q; },
        eq(col: string, val: string) { filters[col] = val; return q; },
        order() { return q; },
        async limit(n: number) {
          if (opts.selectError) return { data: null, error: opts.selectError };
          const data = (opts.rows ?? [])
            .filter((r) => r.user_id === filters.user_id && r.consent_purpose === filters.consent_purpose)
            .sort((a, b) => b.accepted_at.localeCompare(a.accepted_at))
            .slice(0, n);
          return { data, error: null };
        },
        async insert(rows: Record<string, unknown>[]) {
          if (opts.insertError) return { error: opts.insertError };
          inserted.push(...rows);
          return { error: null };
        },
      };
      return q;
    },
  };
  return { db: client as unknown as SupabaseClient, inserted };
}

const U = 'user-1';
const termsV = STUDIO.legal.documents.terms.version;

// ─── Vocabulary stays in step with the migration ────────────────────────────

describe('consent vocabulary matches migration 068', () => {
  const sql = readFileSync(path.join(process.cwd(), 'lib/migrations/068-consent-records.sql'), 'utf8');

  it('every purpose is allowed by the purpose CHECK, and nothing else', () => {
    const m = /consent_purpose in \(([^)]+)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(inSql).toEqual([...CONSENT_PURPOSES].sort());
  });

  it('every source is allowed by the source CHECK, and nothing else', () => {
    const m = /source in \(([^)]+)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(inSql).toEqual([...CONSENT_SOURCES].sort());
  });

  it('every current document version satisfies the version CHECK', () => {
    for (const p of CONSENT_PURPOSES) {
      expect(currentVersion(p)).toMatch(/^[0-9]{4}[-.][0-9]{2}[-.][0-9]{2}$/);
    }
  });

  it('the migration never grants UPDATE or DELETE to client roles', () => {
    expect(sql).not.toMatch(/grant[^;]*\b(update|delete)\b[^;]*to\s+(anon|authenticated)/i);
    expect(sql).not.toMatch(/for\s+(update|delete)/i);
  });
});

// ─── Versions and contexts ──────────────────────────────────────────────────

describe('versions and required consents', () => {
  it('records each purpose against its published document', () => {
    expect(currentVersion('terms')).toBe(STUDIO.legal.documents.terms.version);
    expect(currentVersion('privacy')).toBe(STUDIO.legal.documents.privacy.version);
    expect(currentVersion('biometric')).toBe(STUDIO.legal.documents.biometricNotice.version);
    expect(currentVersion('rental_agreement')).toBe(STUDIO.legal.documents.rentalAgreement.version);
  });

  it('checkout needs terms, privacy and the rental agreement; verification needs biometric', () => {
    expect(requiredConsents('onboarding')).toEqual(['terms', 'privacy']);
    expect(requiredConsents('checkout')).toEqual(['terms', 'privacy', 'rental_agreement']);
    expect(requiredConsents('verification')).toEqual(['biometric']);
    expect(requiredConsents('listing')).toEqual(['owner_terms']);
  });

  it('each context can be satisfied from its own source', () => {
    expect(requiredConsents('onboarding').every((p) => PURPOSES_BY_SOURCE.oauth_onboarding.includes(p))).toBe(true);
    expect(requiredConsents('checkout').every((p) => PURPOSES_BY_SOURCE.checkout.includes(p))).toBe(true);
    expect(requiredConsents('verification').every((p) => PURPOSES_BY_SOURCE.verification.includes(p))).toBe(true);
    expect(requiredConsents('listing').every((p) => PURPOSES_BY_SOURCE.listing.includes(p))).toBe(true);
  });

  it('formats a version date for the Last updated line', () => {
    expect(formatDocumentDate('2026-10-08')).toMatch(/^0?8 October 2026$/);
    expect(formatDocumentDate('2026.04.20')).toBe('2026.04.20');
  });
});

// ─── Request validation ─────────────────────────────────────────────────────

describe('validateConsentRequest', () => {
  it('accepts a well-formed request', () => {
    const r = validateConsentRequest({ purposes: ['terms', 'privacy'], source: 'oauth_onboarding' });
    expect(r).toEqual({ ok: true, value: { purposes: ['terms', 'privacy'], source: 'oauth_onboarding' } });
  });

  it('rejects any field the server decides (version, user, timestamps)', () => {
    for (const extra of [{ version: '2099-01-01' }, { user_id: 'someone-else' }, { accepted_at: '2000-01-01' }, { withdrawn_at: null }]) {
      const r = validateConsentRequest({ purposes: ['terms'], source: 'signup', ...extra });
      expect(r.ok).toBe(false);
    }
  });

  it('rejects unknown purposes and sources', () => {
    expect(validateConsentRequest({ purposes: ['marketing'], source: 'signup' }).ok).toBe(false);
    expect(validateConsentRequest({ purposes: ['terms'], source: 'admin' }).ok).toBe(false);
    expect(validateConsentRequest({ purposes: ['terms'] }).ok).toBe(false);
  });

  it('rejects empty, duplicated or non-array purposes', () => {
    expect(validateConsentRequest({ purposes: [], source: 'signup' }).ok).toBe(false);
    expect(validateConsentRequest({ purposes: ['terms', 'terms'], source: 'signup' }).ok).toBe(false);
    expect(validateConsentRequest({ purposes: 'terms', source: 'signup' }).ok).toBe(false);
  });

  it('rejects a purpose recorded from the wrong place', () => {
    expect(validateConsentRequest({ purposes: ['biometric'], source: 'checkout' }).ok).toBe(false);
    expect(validateConsentRequest({ purposes: ['rental_agreement'], source: 'oauth_onboarding' }).ok).toBe(false);
    expect(validateConsentRequest({ purposes: ['biometric'], source: 'verification' }).ok).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const body of [null, 'terms', 42, ['terms']]) {
      expect(validateConsentRequest(body).ok).toBe(false);
    }
  });
});

// ─── Reading consent ────────────────────────────────────────────────────────

describe('hasCurrentConsent', () => {
  it('is true when the latest row is an acceptance of the current version', async () => {
    const { db } = fakeDb({ rows: [{ user_id: U, consent_purpose: 'terms', document_version: termsV, withdrawn_at: null, accepted_at: '2026-10-08T10:00:00Z' }] });
    expect(await hasCurrentConsent(db, U, 'terms')).toBe(true);
  });

  it('is false when the latest row is a withdrawal', async () => {
    const { db } = fakeDb({ rows: [
      { user_id: U, consent_purpose: 'terms', document_version: termsV, withdrawn_at: null, accepted_at: '2026-10-08T10:00:00Z' },
      { user_id: U, consent_purpose: 'terms', document_version: termsV, withdrawn_at: '2026-10-09T10:00:00Z', accepted_at: '2026-10-09T10:00:00Z' },
    ] });
    expect(await hasCurrentConsent(db, U, 'terms')).toBe(false);
  });

  it('is false when only an older version was accepted', async () => {
    const { db } = fakeDb({ rows: [{ user_id: U, consent_purpose: 'terms', document_version: '2020-01-01', withdrawn_at: null, accepted_at: '2026-10-08T10:00:00Z' }] });
    expect(await hasCurrentConsent(db, U, 'terms')).toBe(false);
  });

  it('is false with no rows, and ignores other users', async () => {
    const { db } = fakeDb({ rows: [{ user_id: 'other', consent_purpose: 'terms', document_version: termsV, withdrawn_at: null, accepted_at: '2026-10-08T10:00:00Z' }] });
    expect(await hasCurrentConsent(db, U, 'terms')).toBe(false);
  });

  it('throws a typed error when the store cannot be read', async () => {
    const { db } = fakeDb({ selectError: { code: '42P01', message: 'relation "public.consent_records" does not exist' } });
    await expect(hasCurrentConsent(db, U, 'terms')).rejects.toBeInstanceOf(ConsentStoreUnavailableError);
  });
});

describe('checkConsents', () => {
  it('lists what is missing', async () => {
    const { db } = fakeDb({ rows: [{ user_id: U, consent_purpose: 'terms', document_version: termsV, withdrawn_at: null, accepted_at: '2026-10-08T10:00:00Z' }] });
    expect(await checkConsents(db, U, requiredConsents('checkout'))).toEqual({ status: 'missing', missing: ['privacy', 'rental_agreement'] });
  });

  it('is ok when everything is current', async () => {
    const rows = requiredConsents('onboarding').map((p) => ({ user_id: U, consent_purpose: p, document_version: currentVersion(p), withdrawn_at: null, accepted_at: '2026-10-08T10:00:00Z' }));
    expect(await checkConsents(fakeDb({ rows }).db, U, requiredConsents('onboarding'))).toEqual({ status: 'ok' });
  });

  it('reports an unavailable store (migration not applied) instead of throwing', async () => {
    const { db } = fakeDb({ selectError: { code: 'PGRST205', message: "Could not find the table 'public.consent_records'" } });
    const r = await checkConsents(db, U, ['terms']);
    expect(r.status).toBe('unavailable');
    expect(r.status === 'unavailable' && r.missingTable).toBe(true);
  });
});

// ─── Writing consent ────────────────────────────────────────────────────────

describe('recordConsent', () => {
  it('inserts one row per purpose at the current versions, with a hashed IP', async () => {
    const { db, inserted } = fakeDb();
    const r = await recordConsent(db, { userId: U, purposes: ['terms', 'privacy', 'rental_agreement'], source: 'checkout', ip: '41.0.0.1', userAgent: 'x'.repeat(2000) });
    expect(r.ok).toBe(true);
    expect(inserted).toHaveLength(3);
    for (const row of inserted) {
      expect(row.user_id).toBe(U);
      expect(row.source).toBe('checkout');
      expect(row.document_version).toBe(currentVersion(row.consent_purpose as 'terms'));
      expect(row.ip_hash).toBeTypeOf('string');
      expect(String(row.ip_hash)).not.toContain('41.0.0.1');
      expect(String(row.user_agent).length).toBeLessThanOrEqual(512);
      expect(row).not.toHaveProperty('withdrawn_at');
      expect(row).not.toHaveProperty('accepted_at');
    }
  });

  it('records a withdrawal as a new row', async () => {
    const { db, inserted } = fakeDb();
    await recordConsent(db, { userId: U, purposes: ['biometric'], source: 'verification', withdraw: true });
    expect(inserted[0].withdrawn_at).toBeTypeOf('string');
  });

  it('reports a failed insert', async () => {
    const { db } = fakeDb({ insertError: { code: '42501', message: 'new row violates row-level security policy' } });
    const r = await recordConsent(db, { userId: U, purposes: ['terms'], source: 'signup' });
    expect(r).toMatchObject({ ok: false, missingTable: false });
  });
});

describe('hashConsentIp', () => {
  it('never stores the address, is stable, and skips unknown', () => {
    const a = hashConsentIp('41.0.0.1');
    expect(a).toBe(hashConsentIp('41.0.0.1'));
    expect(a).not.toContain('41.0.0.1');
    expect(a).not.toBe(hashConsentIp('41.0.0.2'));
    expect(hashConsentIp('unknown')).toBeNull();
    expect(hashConsentIp(null)).toBeNull();
  });
});
