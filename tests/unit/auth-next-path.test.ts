import { describe, it, expect } from 'vitest';
import {
  afterSignInPath,
  cleanNextPath,
  consentStateFromResponse,
  loginUrl,
  readNextParam,
  welcomeUrl,
} from '@/lib/auth/next-path';

const params = (q: string) => new URLSearchParams(q);

describe('cleanNextPath: a same-site destination, never a loop', () => {
  it('keeps a same-site path with its query', () => {
    expect(cleanNextPath('/rentals/x?from=2026-10-03')).toBe('/rentals/x?from=2026-10-03');
    expect(cleanNextPath('%2Fstudio%2Fbirthday')).toBe('/studio/birthday');
  });
  it('refuses anything that could leave the site', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '%2F%2Fevil.com', 'javascript:alert(1)', 'evil.com', '/ok\nx']) {
      expect(cleanNextPath(bad)).toBe('');
    }
  });
  it('drops sign-in and welcome pages so nobody goes round in circles', () => {
    for (const loop of ['/login', '/login?next=%2Fx', '/register', '/reset-password', '/auth/callback?code=1', '/welcome', '/welcome?next=%2Fx']) {
      expect(cleanNextPath(loop)).toBe('');
    }
    // A page that merely starts with the same letters is fine.
    expect(cleanNextPath('/loginhelp')).toBe('/loginhelp');
    expect(cleanNextPath('/welcome-pack')).toBe('/welcome-pack');
  });
  it('is empty for nothing', () => {
    expect(cleanNextPath(null)).toBe('');
    expect(cleanNextPath(undefined)).toBe('');
    expect(cleanNextPath('')).toBe('');
  });
});

describe('readNextParam: ?next= first, the older ?redirect= still works', () => {
  it('prefers next', () => {
    expect(readNextParam(params('next=%2Fa&redirect=%2Fb'))).toBe('/a');
  });
  it('falls back to redirect (booking widget links)', () => {
    expect(readNextParam(params('redirect=%2Frentals%2Fx'))).toBe('/rentals/x');
  });
  it('falls back to redirect when next is unsafe', () => {
    expect(readNextParam(params('next=https%3A%2F%2Fevil.com&redirect=%2Fb'))).toBe('/b');
  });
  it('is empty when neither is usable', () => {
    expect(readNextParam(params(''))).toBe('');
    expect(readNextParam(params('redirect=%2F%2Fevil.com'))).toBe('');
  });
});

describe('welcomeUrl and loginUrl carry the destination', () => {
  it('welcomeUrl', () => {
    expect(welcomeUrl('/rentals/x?y=1')).toBe('/welcome?next=%2Frentals%2Fx%3Fy%3D1');
    expect(welcomeUrl(null)).toBe('/welcome');
    expect(welcomeUrl('/welcome')).toBe('/welcome');
    expect(welcomeUrl('https://evil.com')).toBe('/welcome');
  });
  it('loginUrl', () => {
    expect(loginUrl('/dashboard/bookings?tab=past')).toBe('/login?next=%2Fdashboard%2Fbookings%3Ftab%3Dpast');
    expect(loginUrl('/dashboard')).toBe('/login');
    expect(loginUrl('//evil.com')).toBe('/login');
    expect(loginUrl(null)).toBe('/login');
  });
});

describe('afterSignInPath: the consent routing decision', () => {
  it('sends admins to the admin area', () => {
    expect(afterSignInPath({ isAdmin: true, consent: 'missing', next: '/rentals/x' })).toBe('/admin');
  });
  it('sends anyone without a current acceptance to /welcome, carrying the destination', () => {
    expect(afterSignInPath({ isAdmin: false, consent: 'missing', next: '/rentals/x' })).toBe('/welcome?next=%2Frentals%2Fx');
    expect(afterSignInPath({ isAdmin: false, consent: 'missing', next: '', fallback: '/dashboard' })).toBe('/welcome?next=%2Fdashboard');
  });
  it('does not loop when the fallback is /welcome itself', () => {
    expect(afterSignInPath({ isAdmin: false, consent: 'missing', next: '', fallback: '/welcome' })).toBe('/welcome');
    expect(afterSignInPath({ isAdmin: false, consent: 'ok', next: null, fallback: '/welcome' })).toBe('/welcome');
  });
  it('goes straight on when accepted, or when the store cannot be read', () => {
    expect(afterSignInPath({ isAdmin: false, consent: 'ok', next: '/rentals/x' })).toBe('/rentals/x');
    expect(afterSignInPath({ isAdmin: false, consent: 'unknown', next: '/rentals/x' })).toBe('/rentals/x');
    expect(afterSignInPath({ isAdmin: false, consent: 'ok', next: null })).toBe('/dashboard');
  });
  it('never follows an unsafe destination or fallback', () => {
    expect(afterSignInPath({ isAdmin: false, consent: 'ok', next: 'https://evil.com' })).toBe('/dashboard');
    expect(afterSignInPath({ isAdmin: false, consent: 'ok', next: null, fallback: '//evil.com' })).toBe('/dashboard');
    expect(afterSignInPath({ isAdmin: false, consent: 'missing', next: '//evil.com' })).toBe('/welcome?next=%2Fdashboard');
  });
});

describe('consentStateFromResponse: reading GET /api/consent', () => {
  it('ok when nothing is missing', () => {
    expect(consentStateFromResponse(200, { missing: [] })).toBe('ok');
  });
  it('missing when something is', () => {
    expect(consentStateFromResponse(200, { missing: ['terms'] })).toBe('missing');
  });
  it('unknown for errors or odd bodies', () => {
    expect(consentStateFromResponse(503, { error: 'x' })).toBe('unknown');
    expect(consentStateFromResponse(401, null)).toBe('unknown');
    expect(consentStateFromResponse(200, null)).toBe('unknown');
    expect(consentStateFromResponse(200, { missing: 'terms' })).toBe('unknown');
  });
});
