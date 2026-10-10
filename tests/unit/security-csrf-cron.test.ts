/**
 * Phase 6 security AUTH-4: the CSRF Origin check in proxy.ts was skipped
 * whenever the Origin header was absent, so a cookie-authenticated POST with
 * no Origin went through. AUTH-5: the cron secret was compared with !==.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { csrfRejection } from '@/proxy';
import { secretsEqual, validateCronAuth } from '@/lib/cron/auth';

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const SESSION = 'sb-127-auth-token=base64-eyJ4IjoxfQ';

function req(path: string, opts: { method?: string; origin?: string; referer?: string; cookie?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.origin !== undefined) headers.set('origin', opts.origin);
  if (opts.referer !== undefined) headers.set('referer', opts.referer);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest(`${APP}${path}`, { method: opts.method ?? 'POST', headers });
}

describe('csrfRejection (AUTH-4)', () => {
  afterEach(() => {
    delete process.env.VERCEL_URL;
  });

  it('refuses a cookie-authenticated mutation with no Origin and no Referer (the repro)', () => {
    expect(csrfRejection(req('/api/notifications/mark-all-read', { cookie: SESSION }))?.status).toBe(403);
  });

  it('refuses a cookie-authenticated mutation whose Referer is another site', () => {
    expect(csrfRejection(req('/api/notifications/mark-all-read', { cookie: SESSION, referer: 'https://evil.example/x' }))?.status).toBe(403);
  });

  it('chunked session cookies count as a session too', () => {
    expect(csrfRejection(req('/api/cart', { cookie: 'sb-abc-auth-token.0=x; sb-abc-auth-token.1=y' }))?.status).toBe(403);
  });

  it('allows a same-site Referer when Origin is absent', () => {
    expect(csrfRejection(req('/api/notifications/mark-all-read', { cookie: SESSION, referer: `${APP}/dashboard` }))).toBeNull();
  });

  it.each(['https://evil.example', 'null', 'https://thabangvision-evil.vercel.app'])('refuses Origin %s', (origin) => {
    expect(csrfRejection(req('/api/cart', { origin, cookie: SESSION }))?.status).toBe(403);
  });

  it('allows our own Origin, and this deployment\'s Vercel URL', () => {
    expect(csrfRejection(req('/api/cart', { origin: new URL(APP).origin, cookie: SESSION }))).toBeNull();
    process.env.VERCEL_URL = 'thabangvision-git-develop-team.vercel.app';
    expect(csrfRejection(req('/api/cart', { origin: 'https://thabangvision-git-develop-team.vercel.app', cookie: SESSION }))).toBeNull();
  });

  it('a request with neither Origin nor a session cookie cannot act as anyone and passes', () => {
    expect(csrfRejection(req('/api/contact'))).toBeNull();
  });

  it('webhooks, cron and safe methods are not checked', () => {
    expect(csrfRejection(req('/api/webhooks/paystack', { origin: 'https://evil.example', cookie: SESSION }))).toBeNull();
    expect(csrfRejection(req('/api/cron/invariants', { cookie: SESSION }))).toBeNull();
    expect(csrfRejection(req('/api/bookings', { method: 'GET', cookie: SESSION }))).toBeNull();
  });
});

describe('cron secret comparison (AUTH-5)', () => {
  it('secretsEqual', () => {
    expect(secretsEqual('Bearer abc', 'Bearer abc')).toBe(true);
    expect(secretsEqual('Bearer abd', 'Bearer abc')).toBe(false);
    expect(secretsEqual('Bearer ab', 'Bearer abc')).toBe(false);
    expect(secretsEqual('', 'Bearer abc')).toBe(false);
  });

  it('validateCronAuth', () => {
    process.env.CRON_SECRET = 'unit-cron-secret';
    const call = (auth?: string) =>
      validateCronAuth(new NextRequest(`${APP}/api/cron/invariants`, { headers: auth ? { authorization: auth } : {} }));
    expect(call('Bearer unit-cron-secret')).toBeNull();
    expect(call('Bearer unit-cron-secreT')?.status).toBe(401);
    expect(call()?.status).toBe(401);
  });
});
