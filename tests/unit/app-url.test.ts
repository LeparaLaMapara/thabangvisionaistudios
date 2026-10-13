import { describe, it, expect, afterEach } from 'vitest';
import { appUrl, cleanBaseUrl, envFlag } from '@/lib/app-url';
import { paystackKeyMode } from '@/lib/payments/paystack';

const original = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = original;
});

describe('the public base URL', () => {
  it('drops the trailing newline Vercel was given', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.thabangvision.com\n';
    expect(`${appUrl()}/api/service-bookings/callback`).toBe(
      'https://www.thabangvision.com/api/service-bookings/callback',
    );
  });
  it('drops trailing slashes', () => {
    expect(cleanBaseUrl(' https://x.example/// ')).toBe('https://x.example');
  });
  it('falls back when unset or blank', () => {
    process.env.NEXT_PUBLIC_APP_URL = '  ';
    expect(appUrl('https://fallback.example/')).toBe('https://fallback.example');
  });
});

describe('env flags', () => {
  it('read "true\n" as true', () => {
    expect(envFlag('true\n')).toBe(true);
    expect(envFlag(' TRUE ')).toBe(true);
  });
  it('read anything else as false', () => {
    expect(envFlag(undefined)).toBe(false);
    expect(envFlag('false')).toBe(false);
    expect(envFlag('yes')).toBe(false);
  });
});

describe('Paystack key mode', () => {
  it('tells live from test by prefix only', () => {
    expect(paystackKeyMode('sk_live_abc')).toBe('live');
    expect(paystackKeyMode('pk_live_abc')).toBe('live');
    expect(paystackKeyMode('sk_test_abc\n')).toBe('test');
    expect(paystackKeyMode(undefined)).toBe('missing');
    expect(paystackKeyMode('[SENSITIVE]')).toBe('unrecognised');
  });
});
