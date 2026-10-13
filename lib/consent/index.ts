/**
 * Consent records: server-side helpers over public.consent_records
 * (lib/migrations/068-consent-records.sql).
 *
 * The table is append-only for clients: a person may INSERT rows for their
 * own user id and read their own rows; nothing is ever updated or deleted by
 * a client. Withdrawal is a NEW row with withdrawn_at set, so the history of
 * what was accepted, when, and against which document version is kept.
 *
 * "Current" consent for a purpose = the most recent row for that purpose is
 * not a withdrawal AND was recorded against the version currently published
 * in STUDIO.legal.documents. Bumping a document's version therefore asks
 * everyone to accept again.
 *
 * Server only (node:crypto). Client components import lib/consent/documents.
 */
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  currentVersion,
  type ConsentPurpose,
  type ConsentSource,
} from './documents';

export * from './documents';

export const CONSENT_TABLE = 'consent_records';

const MAX_USER_AGENT = 512;

/**
 * One-way hash of the caller's IP, kept as evidence that an acceptance came
 * from a real request without storing the address itself. Keyed with
 * CONSENT_IP_HASH_SECRET when set (recommended: an unkeyed hash of an IPv4
 * address can be brute-forced).
 */
export function hashConsentIp(ip: string | null | undefined): string | null {
  if (!ip || ip === 'unknown') return null;
  const secret = process.env.CONSENT_IP_HASH_SECRET;
  const digest = secret
    ? crypto.createHmac('sha256', secret).update(ip).digest('hex')
    : crypto.createHash('sha256').update(`consent:${ip}`).digest('hex');
  return digest.slice(0, 32);
}

interface LatestRow {
  document_version: string;
  withdrawn_at: string | null;
  accepted_at: string;
}

/** Postgres / PostgREST codes meaning "the table is not there" (068 not applied). */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation .*consent_records.* does not exist|could not find the table/i.test(error.message ?? '')
  );
}

export class ConsentStoreUnavailableError extends Error {
  constructor(message: string, readonly missingTable: boolean) {
    super(message);
    this.name = 'ConsentStoreUnavailableError';
  }
}

/**
 * Does `userId` hold a current, un-withdrawn consent for `purpose` at
 * `version` (default: the version published now)? Throws
 * ConsentStoreUnavailableError when the table cannot be read.
 */
export async function hasCurrentConsent(
  supabase: SupabaseClient,
  userId: string,
  purpose: ConsentPurpose,
  version: string = currentVersion(purpose),
): Promise<boolean> {
  const { data, error } = await supabase
    .from(CONSENT_TABLE)
    .select('document_version, withdrawn_at, accepted_at')
    .eq('user_id', userId)
    .eq('consent_purpose', purpose)
    .order('accepted_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new ConsentStoreUnavailableError(error.message, isMissingTable(error));
  }
  const latest = (data as LatestRow[] | null)?.[0];
  return !!latest && latest.withdrawn_at === null && latest.document_version === version;
}

export type ConsentCheck =
  | { status: 'ok' }
  | { status: 'missing'; missing: ConsentPurpose[] }
  | { status: 'unavailable'; missingTable: boolean; error: string };

/**
 * Check several purposes at once. Never throws: the caller decides what an
 * unreadable store means (checkout and verification should refuse; a
 * welcome screen may let the person through and log it).
 */
export async function checkConsents(
  supabase: SupabaseClient,
  userId: string,
  purposes: readonly ConsentPurpose[],
): Promise<ConsentCheck> {
  try {
    const results = await Promise.all(
      purposes.map(async (p) => [p, await hasCurrentConsent(supabase, userId, p)] as const),
    );
    const missing = results.filter(([, ok]) => !ok).map(([p]) => p);
    return missing.length === 0 ? { status: 'ok' } : { status: 'missing', missing };
  } catch (err) {
    if (err instanceof ConsentStoreUnavailableError) {
      return { status: 'unavailable', missingTable: err.missingTable, error: err.message };
    }
    return { status: 'unavailable', missingTable: false, error: String(err) };
  }
}

export interface RecordConsentParams {
  userId: string;
  purposes: readonly ConsentPurpose[];
  source: ConsentSource;
  /** Raw client IP; only its hash is stored. */
  ip?: string | null;
  userAgent?: string | null;
  /** Record a withdrawal instead of an acceptance (server/admin use). */
  withdraw?: boolean;
}

export type RecordConsentResult =
  | { ok: true; recorded: { purpose: ConsentPurpose; version: string }[] }
  | { ok: false; error: string; missingTable: boolean };

/**
 * Insert one row per purpose, at the currently published version. With the
 * user's own session client, RLS only lets this succeed for their own id.
 * accepted_at / withdrawn_at are set by the database (see the 068 trigger).
 */
export async function recordConsent(
  supabase: SupabaseClient,
  params: RecordConsentParams,
): Promise<RecordConsentResult> {
  const nowIso = new Date().toISOString();
  const ipHash = hashConsentIp(params.ip);
  const userAgent = params.userAgent ? params.userAgent.slice(0, MAX_USER_AGENT) : null;

  const rows = params.purposes.map((purpose) => ({
    user_id: params.userId,
    consent_purpose: purpose,
    document_version: currentVersion(purpose),
    source: params.source,
    ip_hash: ipHash,
    user_agent: userAgent,
    ...(params.withdraw ? { withdrawn_at: nowIso } : {}),
  }));

  const { error } = await supabase.from(CONSENT_TABLE).insert(rows);
  if (error) {
    return { ok: false, error: error.message, missingTable: isMissingTable(error) };
  }
  return {
    ok: true,
    recorded: rows.map((r) => ({ purpose: r.consent_purpose, version: r.document_version })),
  };
}
