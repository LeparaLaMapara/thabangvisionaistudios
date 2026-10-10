/**
 * Phase 6 security INJ-3: script-src allowed 'unsafe-inline', so injected
 * markup (INJ-1) ran with zero CSP violations. The policy is now built per
 * request with a nonce and 'strict-dynamic' (lib/security/csp.ts, proxy.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildCsp, generateNonce } from '@/lib/security/csp';

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const scriptSrc = (csp: string): string => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';

describe('buildCsp', () => {
  it('script-src: nonce + strict-dynamic, never unsafe-inline (or unsafe-eval outside dev)', () => {
    const csp = buildCsp('abc123==');
    const s = scriptSrc(csp);
    expect(s).toContain("'nonce-abc123=='");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain('unsafe-inline');
    expect(s).not.toContain('unsafe-eval');
    expect(scriptSrc(buildCsp('n', { dev: true }))).toContain("'unsafe-eval'");
  });

  it('keeps the other protections', () => {
    const csp = buildCsp('n');
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "default-src 'self'"]) expect(csp).toContain(d);
  });

  it('nonces are fresh and long enough', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });
});

describe('proxy sets the CSP per request', () => {
  it('the page response carries a nonce CSP, and the request carries the same one for Next.js', async () => {
    const { proxy } = await import('@/proxy');
    const req = new NextRequest('http://localhost:3000/rentals');
    const res = await proxy(req);
    const header = res.headers.get('content-security-policy') ?? '';
    expect(scriptSrc(header)).toMatch(/'nonce-[A-Za-z0-9+/=]{20,}'/);
    expect(header).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(req.headers.get('content-security-policy')).toBe(header);
    const second = await proxy(new NextRequest('http://localhost:3000/rentals'));
    expect(second.headers.get('content-security-policy')).not.toBe(header);
  });
});

describe('next.config.ts no longer sends the static unsafe-inline policy', () => {
  it('has no Content-Security-Policy header of its own', async () => {
    const config = (await import('@/next.config')).default as { headers?: () => Promise<Array<{ headers: Array<{ key: string }> }>> };
    const all = (await config.headers?.()) ?? [];
    expect(all.flatMap((h) => h.headers.map((x) => x.key.toLowerCase()))).not.toContain('content-security-policy');
  });
});
