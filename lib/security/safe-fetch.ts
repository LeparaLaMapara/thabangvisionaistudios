/**
 * Server-side fetch of a URL that a person (or a model) supplied.
 *
 * Phase 6 security INJ-2 / INJ-4: the portfolio analyser, the admin EXIF
 * reader and the production describer called fetch(url) on whatever URL they
 * were given, so any signed-in user could make the server request
 * http://127.0.0.1:..., the cloud metadata address (169.254.169.254) or
 * anything else on the private network.
 *
 * safeFetch():
 *   - https only, default port only, no user:password@ in the URL;
 *   - resolves the host and refuses loopback, private, link-local, CGNAT,
 *     multicast, reserved and documentation ranges (IPv4 and IPv6, including
 *     IPv4-mapped/NAT64 forms). The check runs inside the socket's own DNS
 *     lookup, so the address that is checked is the address connected to (no
 *     DNS-rebinding gap between "check" and "connect");
 *   - follows at most N redirects itself, re-checking every hop;
 *   - stops reading after a byte limit and after a timeout.
 *
 * Use it for every server fetch of a user-influenced URL. Server-made URLs
 * (Supabase signed URLs, provider APIs) do not need it.
 */
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';
import { STUDIO } from '@/lib/constants';

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

// ─── Address ranges ─────────────────────────────────────────────────────────

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0;
  });
}

/** IPv6 text to 8 16-bit groups (handles `::` and a dotted IPv4 tail). */
function v6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (net.isIPv4(tail[1]) === false) return null;
    const n = v4ToInt(tail[1]);
    text = `${text.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isBlockedV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  const embeddedV4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const allZero = (from: number, to: number): boolean => g.slice(from, to).every((x) => x === 0);

  if (allZero(0, 8)) return true; // ::
  if (allZero(0, 7) && g[7] === 1) return true; // ::1
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible): judge the IPv4.
  if (allZero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(embeddedV4(g[6], g[7]));
  // 64:ff9b::/96 NAT64 and 64:ff9b:1::/48: judge the embedded IPv4.
  if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedV4(embeddedV4(g[6], g[7]));
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return true; // 6to4 (embeds an IPv4 anywhere)
  if (g[0] === 0x0100 && allZero(1, 4)) return true; // 100::/64 discard
  return false;
}

/** True when an IP address must never be fetched by the server. Non-IPs are blocked. */
export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true;
}

// ─── URL checks ─────────────────────────────────────────────────────────────

/**
 * Parse and check a URL before any request: https, default port, no
 * credentials, and an IP-literal host must be public. Throws BlockedUrlError.
 * (A host name is checked when it is resolved, in guardedLookup.)
 */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new BlockedUrlError('Only https URLs can be fetched.');
  if (url.username || url.password) throw new BlockedUrlError('URLs with credentials are refused.');
  if (url.port && url.port !== '443') throw new BlockedUrlError('Only the default https port is allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) throw new BlockedUrlError('That address is not reachable.');
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal') || lower.endsWith('.local')) {
    throw new BlockedUrlError('That address is not reachable.');
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * DNS lookup used by the socket itself: resolves every address for the host
 * and refuses the connection when ANY of them is blocked.
 */
export const guardedLookup = ((
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
): void => {
  dns.lookup(hostname, { all: true, family: options?.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const blocked = new BlockedUrlError('That address is not reachable.') as NodeJS.ErrnoException;
      blocked.code = 'EBLOCKED';
      return callback(blocked, '');
    }
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}) as unknown as LookupFunction;

// ─── Requests ───────────────────────────────────────────────────────────────

export interface SafeResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: Buffer;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

/** One request, no redirects followed. */
export type Transport = (url: URL, opts: Required<Omit<SafeFetchOptions, 'maxRedirects'>>) => Promise<SafeResponse>;

const httpsTransport: Transport = (url, opts) =>
  new Promise<SafeResponse>((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers: opts.headers, lookup: guardedLookup, agent: false, timeout: opts.timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy(new BlockedUrlError('The response is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers[k] = v;
          const status = res.statusCode ?? 0;
          resolve({ status, ok: status >= 200 && status < 300, headers, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new BlockedUrlError('The request timed out.')));
    req.on('error', reject);
    req.end();
  });

/**
 * Follow up to `maxRedirects` redirects, checking each URL before it is
 * requested. Exported with a pluggable transport for tests.
 */
export async function followRedirects(raw: string, transport: Transport, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const limits = STUDIO.security.fetch;
  const opts = {
    maxBytes: options.maxBytes ?? limits.maxImageBytes,
    timeoutMs: options.timeoutMs ?? limits.timeoutMs,
    headers: options.headers ?? {},
  };
  const maxRedirects = options.maxRedirects ?? limits.maxRedirects;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = assertSafeUrl(current);
    const res = await transport(url, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, url).href;
      continue;
    }
    return res;
  }
  throw new BlockedUrlError('Too many redirects.');
}

/** GET a user-supplied URL safely (see the file comment). */
export function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  return followRedirects(raw, httpsTransport, options);
}

/**
 * Fetch a user-supplied image URL and return it base64-encoded. Refuses a
 * response that is not 2xx or not an image.
 */
export async function fetchImageAsBase64Safe(raw: string, options: SafeFetchOptions = {}): Promise<string> {
  const res = await safeFetch(raw, options);
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}).`);
  const type = res.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('image/')) throw new BlockedUrlError('That URL is not an image.');
  return res.body.toString('base64');
}
