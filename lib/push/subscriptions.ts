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

/** Most browsers a person may turn notifications on in. Older ones go first when a new one is added. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * The push services browsers actually use (Chrome/Edge/Opera via FCM,
 * Firefox, Safari, Windows). Anything else is refused: the server POSTs to
 * the stored endpoint, so an open list would let anyone aim our server at
 * any address. Same list as the 088 table check.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function isPushHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PUSH_HOSTS.includes(h) || PUSH_HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length);
}

/** True for an https URL on a known push service, with no user, password or port. */
export function isPushEndpoint(endpoint: string): boolean {
  if (!endpoint || endpoint.length > 1000 || /[\s\\]/.test(endpoint)) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && isPushHost(url.hostname);
}

export function parseSubscription(body: unknown): ValidSubscription | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint.trim() : '';
  const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh.trim() : '';
  const auth = typeof b.keys?.auth === 'string' ? b.keys.auth.trim() : '';
  if (!isPushEndpoint(endpoint)) return null;
  if (p256dh.length < 20 || p256dh.length > 200 || !B64URL.test(p256dh)) return null;
  if (auth.length < 8 || auth.length > 100 || !B64URL.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export function parseEndpoint(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const e = (body as { endpoint?: unknown }).endpoint;
  return typeof e === 'string' && e.startsWith('https://') && e.length <= 1000 ? e : null;
}

/**
 * Whether a browser's subscription may move from one account to another
 * (someone else signed in on the same browser). The browser sends the same
 * keys for the same subscription, so matching keys prove it is that browser;
 * knowing only the endpoint URL is not enough.
 */
export function mayMoveSubscription(
  stored: { user_id: string; p256dh: string; auth: string },
  incoming: { userId: string; p256dh: string; auth: string },
): boolean {
  if (stored.user_id === incoming.userId) return true;
  return stored.p256dh === incoming.p256dh && stored.auth === incoming.auth;
}
