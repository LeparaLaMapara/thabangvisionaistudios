import webpush from 'web-push';
import { STUDIO } from '@/lib/constants';
import { isPushEndpoint } from './subscriptions';

/** Real push services answer in well under a second; a slow one must not hold the queue. */
export const PUSH_TIMEOUT_MS = 4_000;

/**
 * Web push provider (VAPID, via the web-push library). The only file that
 * imports the SDK; everything else calls sendPush().
 *
 * Env: VAPID_PUBLIC_KEY (or NEXT_PUBLIC_VAPID_PUBLIC_KEY), VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT (a mailto: or https: contact; defaults to STUDIO.email).
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Same-site path opened when the notification is tapped. */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
}

export type PushResult =
  | { ok: true }
  /** gone: the browser dropped the subscription (404/410); delete it. */
  | { ok: false; gone: boolean; retryable: boolean; message: string };

function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || `mailto:${STUDIO.email}`).trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return vapid() !== null;
}

/** The public key browsers subscribe with (safe to show). Null when push is off. */
export function pushPublicKey(): string | null {
  return vapid()?.publicKey ?? null;
}

/**
 * Only a path on this site may be opened from a notification. Any control
 * character, space or backslash is refused: the URL parser drops a tab or
 * newline, so "/\t/evil.example" would otherwise open evil.example.
 * public/sw.js has the same check.
 */
export function safePushUrl(url: string | null | undefined): string {
  const u = (url ?? '').trim();
  if (!u.startsWith('/') || u.startsWith('//') || /[\u0000- \u007f\\]/.test(u)) return '/dashboard';
  return u.slice(0, 500);
}

/** Sends one push. Never throws. */
export async function sendPush(sub: PushSubscriptionKeys, payload: PushPayload): Promise<PushResult> {
  const keys = vapid();
  if (!keys) return { ok: false, gone: false, retryable: false, message: 'push not configured' };
  // Never POST anywhere but a real push service (rows saved before 088 too).
  if (!isPushEndpoint(sub.endpoint)) return { ok: false, gone: true, retryable: false, message: 'not a push service' };
  const body = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 240),
    url: safePushUrl(payload.url),
    ...(payload.tag ? { tag: payload.tag.slice(0, 64) } : {}),
  });
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
      vapidDetails: keys,
      TTL: 60 * 60 * 24,
      urgency: 'normal',
      timeout: PUSH_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (err) {
    const status = typeof err === 'object' && err !== null && 'statusCode' in err ? Number((err as { statusCode: unknown }).statusCode) : 0;
    const message = err instanceof Error ? err.message : 'push failed';
    if (status === 404 || status === 410) return { ok: false, gone: true, retryable: false, message: `gone (${status})` };
    return { ok: false, gone: false, retryable: status === 0 || status === 429 || status >= 500, message: `${status || 'network'}: ${message}`.slice(0, 300) };
  }
}
