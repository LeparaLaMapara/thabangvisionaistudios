import { STUDIO } from '@/lib/constants';
import { bannedMessage } from '@/lib/auth/redirect';

/**
 * Plain rules and plain words for email + password accounts (owner decision
 * 2026-10-14: sign-in is ONLY "Continue with Google" or email + password).
 *
 * The minimum length matches the hosted Supabase setting password_min_length
 * (8 on thabangvision-prod, no required character classes). The sign-in
 * health check (ops/auth/expected-auth-config.json) alerts if that setting
 * drifts away from this one.
 */
export const PASSWORD_MIN_LENGTH = STUDIO.platform.minPasswordLength;

/** The rule as shown under the password field. */
export const PASSWORD_RULE = `At least ${PASSWORD_MIN_LENGTH} characters.`;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A problem with a new password, or null when it meets the rule. */
export function newPasswordProblem(password: string): string | null {
  if (!password) return 'Please choose a password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

type AuthErr = { message?: string; code?: string; status?: number } | null | undefined;

export type FailureField = 'email' | 'password' | null;
export interface Failure {
  text: string;
  field: FailureField;
  /** The address is not confirmed yet: offer to send the confirmation again. */
  unconfirmed?: boolean;
}

function tooSoon(err: NonNullable<AuthErr>): boolean {
  return (
    err.status === 429 ||
    err.code === 'over_email_send_rate_limit' ||
    err.code === 'over_request_rate_limit' ||
    /rate limit|security purposes/i.test(err.message ?? '')
  );
}

/** What to say when signInWithPassword fails. */
export function signInFailure(err: AuthErr, contactEmail: string): Failure {
  const banned = bannedMessage(err, contactEmail);
  if (banned) return { text: banned, field: 'password' };
  if (err?.code === 'email_not_confirmed' || /not confirmed/i.test(err?.message ?? '')) {
    return {
      text: 'Please confirm your email first. Tap the link in the email we sent when you created your account.',
      field: null,
      unconfirmed: true,
    };
  }
  if (err && tooSoon(err)) {
    return { text: 'Too many tries just now. Please wait a minute and try again.', field: null };
  }
  if (err?.code === 'invalid_credentials' || /invalid login credentials/i.test(err?.message ?? '')) {
    return {
      text: "That email and password don't match. Try again, or use Forgot password to set a new one.",
      field: 'password',
    };
  }
  return { text: 'Sign-in did not work just now. Please try again.', field: 'password' };
}

/** What to say when signUp fails. */
export function signUpFailure(err: AuthErr, contactEmail: string): Failure {
  const banned = bannedMessage(err, contactEmail);
  if (banned) return { text: banned, field: 'email' };
  if (err && tooSoon(err)) {
    return {
      text: "We've just sent you an email. Check your inbox and spam folder, or wait a minute and try again.",
      field: null,
    };
  }
  if (err?.code === 'weak_password' || /password/i.test(err?.message ?? '')) {
    return { text: `Please choose a stronger password. ${PASSWORD_RULE}`, field: 'password' };
  }
  if (err?.code === 'user_already_exists' || /already registered/i.test(err?.message ?? '')) {
    return {
      text: 'This email already has an account. Sign in instead, or use Forgot password to set a new one.',
      field: 'email',
    };
  }
  if (err?.code === 'email_address_invalid' || /invalid/i.test(err?.message ?? '')) {
    return { text: 'Please enter a valid email address.', field: 'email' };
  }
  if (err?.code === 'signup_disabled') {
    return { text: `New accounts are paused just now. Please email ${contactEmail} and we'll help.`, field: null };
  }
  return { text: "We couldn't create your account just now. Please try again, or continue with Google.", field: null };
}

/**
 * With email confirmation on, Supabase answers a sign-up for an address that
 * already has a confirmed account with a user that has no identities (so it
 * does not reveal which addresses exist) and sends no email.
 */
export function isExistingAccount(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
}
