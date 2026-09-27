import { describe, it, expect } from 'vitest';
import { safeNextPath, authCallbackUrl, withRedirect, signInErrorMessage } from '@/lib/auth/redirect';

describe('safeNextPath: back to where you were, never off the site', () => {
  it('keeps a same-site path with its query', () => {
    expect(safeNextPath('/rentals/cameras-optics/sony-alpha-a7-iii?from=2026-10-03')).toBe('/rentals/cameras-optics/sony-alpha-a7-iii?from=2026-10-03');
    expect(safeNextPath('%2Fstudio%2Ffamily-birthday')).toBe('/studio/family-birthday');
  });
  it('refuses anything that could leave the site or run script', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '%2F%5Cevil.com', 'javascript:alert(1)', 'evil.com', '%2F%2Fevil.com', '/ok\nx', '%E0%A4%A']) {
      expect(safeNextPath(bad)).toBe('/dashboard');
    }
  });
  it('uses the fallback when nothing is given', () => {
    expect(safeNextPath(null)).toBe('/dashboard');
    expect(safeNextPath('', '/x')).toBe('/x');
  });
});

describe('authCallbackUrl and withRedirect carry the destination', () => {
  it('adds next only when it is not the default', () => {
    expect(authCallbackUrl('https://www.thabangvision.com', '/dashboard')).toBe('https://www.thabangvision.com/auth/callback');
    expect(authCallbackUrl('https://www.thabangvision.com', '/rentals/x')).toBe('https://www.thabangvision.com/auth/callback?next=%2Frentals%2Fx');
    expect(authCallbackUrl('https://www.thabangvision.com', 'https://evil.com')).toBe('https://www.thabangvision.com/auth/callback');
  });
  it('keeps the destination when switching between sign in and sign up', () => {
    expect(withRedirect('/register', '/rentals/x')).toBe('/register?redirect=%2Frentals%2Fx');
    expect(withRedirect('/login', '/dashboard')).toBe('/login');
  });
});

describe('signInErrorMessage', () => {
  it('explains a failed sign-in in plain words', () => {
    expect(signInErrorMessage('auth')).toMatch(/didn't finish/);
    expect(signInErrorMessage(null)).toBeNull();
  });
});
