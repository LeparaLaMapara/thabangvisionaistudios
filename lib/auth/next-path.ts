/**
 * Where a person goes after signing in, in one place, so the sign-in page,
 * the email-code step, the auth callback, /welcome and the dashboard guard
 * all agree.
 *
 * Pure and browser-safe. Builds on safeNextPath (lib/auth/redirect.ts), which
 * refuses anything that could leave the site.
 */
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from './redirect';

/** Anything with URLSearchParams' get(): URLSearchParams, ReadonlyURLSearchParams. */
export interface ParamReader {
  get(name: string): string | null;
}

/** Pages that must never be a destination after sign-in (they would loop). */
const AUTH_PAGES = ['/login', '/register', '/reset-password', '/auth/', '/welcome'];

function isAuthPage(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return AUTH_PAGES.some((p) =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * A safe, same-site destination, or '' when there is none. Sign-in and
 * welcome pages are dropped so a destination can never send someone round
 * in a loop.
 */
export function cleanNextPath(value: string | null | undefined): string {
  const safe = safeNextPath(value, '');
  if (!safe || isAuthPage(safe)) return '';
  return safe;
}

/**
 * The destination carried on a sign-in URL. `next` is the current name;
 * `redirect` is still read because existing links (the booking widget,
 * withRedirect()) use it.
 */
export function readNextParam(params: ParamReader): string {
  return cleanNextPath(params.get('next')) || cleanNextPath(params.get('redirect'));
}

/** /welcome, carrying where to go once the terms are accepted. */
export function welcomeUrl(next: string | null | undefined): string {
  const safe = cleanNextPath(next);
  return safe ? `/welcome?next=${encodeURIComponent(safe)}` : '/welcome';
}

/** The sign-in page, carrying where to come back to (omitted for the default). */
export function loginUrl(next: string | null | undefined): string {
  const safe = cleanNextPath(next);
  return safe && safe !== DEFAULT_AFTER_SIGN_IN ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}

/**
 * What we know about the person's acceptance of the current Terms and
 * Privacy Policy. 'unknown' = the consent store could not be read; the
 * person is let through (checkout and verification check again).
 */
export type ConsentState = 'ok' | 'missing' | 'unknown';

export interface AfterSignInInput {
  isAdmin: boolean;
  consent: ConsentState;
  /** Where they were going (already from the URL; cleaned again here). */
  next: string | null | undefined;
  /** Where to go when there is no `next`. */
  fallback?: string;
}

/**
 * The one decision: admins to the admin area; anyone without a current
 * acceptance to /welcome (which records it with one tap, then carries on to
 * the destination); everyone else straight to where they were going.
 */
export function afterSignInPath({ isAdmin, consent, next, fallback = DEFAULT_AFTER_SIGN_IN }: AfterSignInInput): string {
  if (isAdmin) return '/admin';
  const fallbackPath = safeNextPath(fallback, DEFAULT_AFTER_SIGN_IN);
  const destination = cleanNextPath(next) || fallbackPath;
  if (consent === 'missing') return welcomeUrl(destination);
  return destination;
}

/**
 * Read GET /api/consent?context=onboarding. 200 with an empty `missing` list
 * = ok; 200 with something missing = missing; anything else = unknown.
 */
export function consentStateFromResponse(status: number, body: unknown): ConsentState {
  if (status !== 200 || typeof body !== 'object' || body === null) return 'unknown';
  const missing = (body as { missing?: unknown }).missing;
  if (!Array.isArray(missing)) return 'unknown';
  return missing.length > 0 ? 'missing' : 'ok';
}
