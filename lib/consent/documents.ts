/**
 * Consent vocabulary and validation. Pure and browser-safe: it reads only
 * lib/constants, so client components (the acceptance checkboxes) can import
 * it. The database helpers live in lib/consent/index.ts (server only).
 *
 * The allowed values here MUST match the CHECK constraints in
 * lib/migrations/068-consent-records.sql.
 */
import { STUDIO } from '@/lib/constants';

export const CONSENT_PURPOSES = [
  'terms',
  'privacy',
  'biometric',
  'rental_agreement',
  'owner_terms',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_SOURCES = [
  'signup',
  'oauth_onboarding',
  'checkout',
  'verification',
  'listing',
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Where in the product a set of consents is required. */
export type ConsentContext = 'onboarding' | 'checkout' | 'verification' | 'listing';

export interface LegalDocument {
  version: string;
  label: string;
  href: string;
}

/**
 * The published document each purpose is recorded against.
 *
 * owner_terms has no document of its own yet: owners and creators accept
 * Part D of the Terms of Service, so it is versioned with the Terms until a
 * separate owner/creator agreement exists (see the legal-review checklist).
 */
export function documentFor(purpose: ConsentPurpose): LegalDocument {
  const docs = STUDIO.legal.documents;
  switch (purpose) {
    case 'terms':            return docs.terms;
    case 'privacy':          return docs.privacy;
    case 'biometric':        return docs.biometricNotice;
    case 'rental_agreement': return docs.rentalAgreement;
    case 'owner_terms':      return docs.terms;
  }
}

/** The version a new acceptance of this purpose is recorded against. */
export function currentVersion(purpose: ConsentPurpose): string {
  return documentFor(purpose).version;
}

/** The consents a person must hold, current, before doing the thing in `context`. */
export function requiredConsents(context: ConsentContext): ConsentPurpose[] {
  switch (context) {
    case 'onboarding':   return ['terms', 'privacy'];
    case 'checkout':     return ['terms', 'privacy', 'rental_agreement'];
    case 'verification': return ['biometric'];
    case 'listing':      return ['owner_terms'];
  }
}

/**
 * Which purposes may be recorded from which place. Keeps the record honest:
 * a biometric consent can only come from the verification step, a rental
 * agreement acceptance only from checkout, and so on.
 */
export const PURPOSES_BY_SOURCE: Record<ConsentSource, readonly ConsentPurpose[]> = {
  signup:           ['terms', 'privacy'],
  oauth_onboarding: ['terms', 'privacy'],
  checkout:         ['terms', 'privacy', 'rental_agreement'],
  verification:     ['biometric', 'privacy'],
  listing:          ['owner_terms', 'terms', 'privacy'],
};

export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return typeof value === 'string' && (CONSENT_PURPOSES as readonly string[]).includes(value);
}

export function isConsentSource(value: unknown): value is ConsentSource {
  return typeof value === 'string' && (CONSENT_SOURCES as readonly string[]).includes(value);
}

export interface ConsentRequest {
  purposes: ConsentPurpose[];
  source: ConsentSource;
}

export type ConsentRequestValidation =
  | { ok: true; value: ConsentRequest }
  | { ok: false; error: string };

const ALLOWED_KEYS = new Set(['purposes', 'source']);

/**
 * Strict validation of a POST /api/consent body: only `purposes` and
 * `source`; no versions, timestamps, user ids or anything else (the server
 * decides those). Purposes must be non-empty, unique and allowed for the
 * source.
 */
export function validateConsentRequest(body: unknown): ConsentRequestValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length > 0) {
    return { ok: false, error: `Unexpected field(s): ${extra.join(', ')}.` };
  }

  const { purposes, source } = record;
  if (!isConsentSource(source)) {
    return { ok: false, error: 'Unknown consent source.' };
  }
  if (!Array.isArray(purposes) || purposes.length === 0) {
    return { ok: false, error: 'purposes must be a non-empty array.' };
  }
  if (purposes.length > CONSENT_PURPOSES.length) {
    return { ok: false, error: 'Too many purposes.' };
  }
  if (!purposes.every(isConsentPurpose)) {
    return { ok: false, error: 'Unknown consent purpose.' };
  }
  if (new Set(purposes).size !== purposes.length) {
    return { ok: false, error: 'Duplicate consent purpose.' };
  }
  const allowed = PURPOSES_BY_SOURCE[source];
  const notAllowed = purposes.filter((p) => !allowed.includes(p));
  if (notAllowed.length > 0) {
    return { ok: false, error: `Purpose(s) not accepted from ${source}: ${notAllowed.join(', ')}.` };
  }

  return { ok: true, value: { purposes: [...purposes], source } };
}

/**
 * "2026-10-08" -> "8 October 2026", for the "Last updated" line on the legal
 * pages. A version that is not an ISO date is shown as it is.
 */
export function formatDocumentDate(version: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version);
  if (!m) return version;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(date.getTime())) return version;
  return date.toLocaleDateString(STUDIO.currency.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
