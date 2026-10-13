/**
 * Phase 6 security INJ-2 / INJ-4: server fetches of user-supplied URLs must
 * never reach loopback, private, link-local or metadata addresses, nor follow
 * a redirect to one, nor use plain http.
 */
import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BlockedUrlError,
  assertSafeUrl,
  followRedirects,
  isBlockedAddress,
  safeFetch,
  type SafeResponse,
  type Transport,
} from '@/lib/security/safe-fetch';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '::127.0.0.1', 'ff02::1', '2002:7f00:1::',
    'not-an-ip', '',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '104.16.0.1', '151.101.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe('assertSafeUrl', () => {
  it.each([
    'http://res.cloudinary.com/x/image/upload/a.jpg',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/',
    'https://metadata.google.internal/',
    'https://user:pw@example.com/',
    'https://example.com:8443/',
    'file:///etc/passwd',
    'gopher://127.0.0.1:6379/',
    'not a url',
  ])('refuses %s', (u) => {
    expect(() => assertSafeUrl(u)).toThrow(BlockedUrlError);
  });

  it('accepts a public https URL', () => {
    expect(assertSafeUrl('https://res.cloudinary.com/our/image/upload/a.jpg').hostname).toBe('res.cloudinary.com');
  });
});

describe('followRedirects re-checks every hop', () => {
  const ok: SafeResponse = { status: 200, ok: true, headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('x') };
  const redirectTo = (location: string): Transport => {
    const seen: string[] = [];
    const t: Transport = async (url) => {
      seen.push(url.href);
      if (seen.length === 1) return { status: 302, ok: false, headers: { location }, body: Buffer.alloc(0) };
      return ok;
    };
    return t;
  };

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1:3000/api/admin',
    'https://[::ffff:10.0.0.1]/',
  ])('refuses a redirect to %s', async (location) => {
    await expect(followRedirects('https://public.example/a.jpg', redirectTo(location))).rejects.toThrow(BlockedUrlError);
  });

  it('follows a redirect to another public https URL', async () => {
    const res = await followRedirects('https://public.example/a.jpg', redirectTo('https://cdn.example/b.jpg'));
    expect(res.status).toBe(200);
  });

  it('stops after the redirect limit', async () => {
    const loop: Transport = async () => ({ status: 301, ok: false, headers: { location: 'https://public.example/again' }, body: Buffer.alloc(0) });
    await expect(followRedirects('https://public.example/a', loop, { maxRedirects: 2 })).rejects.toThrow(/Too many redirects/);
  });
});

describe('safeFetch checks the address it actually connects to', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a public-looking host name that resolves to loopback (DNS rebinding)', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _host: string,
      _opts: unknown,
      cb: (err: null, addrs: dns.LookupAddress[]) => void,
    ) => cb(null, [{ address: '127.0.0.1', family: 4 }])) as unknown as typeof dns.lookup);
    await expect(safeFetch('https://totally-public.example/a.jpg', { timeoutMs: 2000 })).rejects.toThrow(/not reachable/);
  });

  it('refuses when any resolved address is private', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _host: string,
      _opts: unknown,
      cb: (err: null, addrs: dns.LookupAddress[]) => void,
    ) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '10.1.2.3', family: 4 }])) as unknown as typeof dns.lookup);
    await expect(safeFetch('https://mixed.example/a.jpg', { timeoutMs: 2000 })).rejects.toThrow(/not reachable/);
  });
});
