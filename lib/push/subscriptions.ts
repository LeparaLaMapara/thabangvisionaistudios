/**
 * Validating what a browser sends when it subscribes to push. Pure, tested
 * in tests/unit/push-subscriptions.test.ts. Matches the 087 table checks.
 */

export interface ValidSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function parseSubscription(body: unknown): ValidSubscription | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint.trim() : '';
  const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh.trim() : '';
  const auth = typeof b.keys?.auth === 'string' ? b.keys.auth.trim() : '';
  if (!endpoint || endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (p256dh.length < 20 || p256dh.length > 200 || !B64URL.test(p256dh)) return null;
  if (auth.length < 8 || auth.length > 100 || !B64URL.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export function parseEndpoint(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const e = (body as { endpoint?: unknown }).endpoint;
  return typeof e === 'string' && e.startsWith('https://') && e.length <= 1000 ? e : null;
}
