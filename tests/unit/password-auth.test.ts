import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE,
  isExistingAccount,
  newPasswordProblem,
  signInFailure,
  signUpFailure,
} from '@/lib/auth/password-auth';

const CONTACT = 'hello@example.com';

describe('password rule', () => {
  it('matches the hosted Supabase minimum watched by the sign-in health check', () => {
    const expected = JSON.parse(readFileSync('ops/auth/expected-auth-config.json', 'utf8'));
    expect(PASSWORD_MIN_LENGTH).toBe(expected.auth.password_min_length);
    expect(PASSWORD_RULE).toBe(`At least ${PASSWORD_MIN_LENGTH} characters.`);
  });

  it('refuses an empty or short password and accepts one at the minimum', () => {
    expect(newPasswordProblem('')).toMatch(/choose a password/i);
    expect(newPasswordProblem('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(new RegExp(`${PASSWORD_MIN_LENGTH} characters`));
    expect(newPasswordProblem('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });
});

describe('signInFailure', () => {
  it('says plainly when the email and password do not match', () => {
    const f = signInFailure({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }, CONTACT);
    expect(f.field).toBe('password');
    expect(f.text).toMatch(/don't match/);
    expect(f.text).toMatch(/forgot password/i);
  });

  it('sends an unconfirmed address to the confirm step', () => {
    const f = signInFailure({ code: 'email_not_confirmed', message: 'Email not confirmed' }, CONTACT);
    expect(f.unconfirmed).toBe(true);
    expect(f.text).toMatch(/confirm your email/i);
  });

  it('keeps the suspended-account message with the contact address', () => {
    const f = signInFailure({ code: 'user_banned', message: 'User is banned' }, CONTACT);
    expect(f.text).toContain(CONTACT);
  });

  it('handles rate limits and unknown errors without leaking raw messages', () => {
    expect(signInFailure({ status: 429, message: 'x' }, CONTACT).text).toMatch(/wait a minute/i);
    expect(signInFailure({ message: 'some internal thing' }, CONTACT).text).not.toContain('internal');
  });
});

describe('signUpFailure', () => {
  it('maps a weak password to the password field with the rule', () => {
    const f = signUpFailure({ code: 'weak_password', message: 'Password should be at least 8 characters.' }, CONTACT);
    expect(f.field).toBe('password');
    expect(f.text).toContain(PASSWORD_RULE);
  });

  it('maps rate limits, bad addresses, bans and disabled sign-ups', () => {
    expect(signUpFailure({ code: 'over_email_send_rate_limit' }, CONTACT).text).toMatch(/just sent you an email/i);
    expect(signUpFailure({ code: 'email_address_invalid', message: 'Email address is invalid' }, CONTACT).field).toBe('email');
    expect(signUpFailure({ code: 'user_banned' }, CONTACT).text).toContain(CONTACT);
    expect(signUpFailure({ code: 'signup_disabled', message: 'Signups not allowed' }, CONTACT).text).toContain(CONTACT);
  });
});

describe('isExistingAccount', () => {
  it('spots the identity-less user Supabase returns for an address that already has an account', () => {
    expect(isExistingAccount({ identities: [] })).toBe(true);
    expect(isExistingAccount({ identities: [{}] })).toBe(false);
    expect(isExistingAccount(null)).toBe(false);
  });
});

describe('no passwordless sign-in anywhere in the app (owner decision 2026-10-14)', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(tsx?|mjs)$/.test(name) ? [path] : [];
    });
  }

  it('never calls signInWithOtp or verifyOtp for email', () => {
    const offenders = ['app', 'components', 'lib']
      .flatMap(files)
      .filter((f) => /signInWithOtp|verifyOtp\(\s*\{\s*email/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
