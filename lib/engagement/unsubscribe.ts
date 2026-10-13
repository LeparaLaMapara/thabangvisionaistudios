import { createHmac, timingSafeEqual } from 'node:crypto';
import { STUDIO } from '@/lib/constants';
import { appUrl } from '@/lib/app-url';

/**
 * Signed one-click unsubscribe for lifecycle emails.
 *
 * The link carries the user id and an HMAC of it under
 * ENGAGEMENT_SIGNING_SECRET, so nobody can stop someone else's emails by
 * guessing ids, and the link works without signing in. The signature never
 * expires: an unsubscribe link must keep working in an old email.
 */

const PURPOSE = 'lifecycle-unsubscribe:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string | null {
  const s = (process.env.ENGAGEMENT_SIGNING_SECRET ?? '').trim();
  return s.length >= 32 ? s : null;
}

export function isUnsubscribeConfigured(): boolean {
  return secret() !== null;
}

export function signUnsubscribe(userId: string, key: string | null = secret()): string {
  if (!key) throw new Error('ENGAGEMENT_SIGNING_SECRET is not set (32 or more characters)');
  if (!UUID.test(userId)) throw new Error('not a user id');
  return createHmac('sha256', key).update(PURPOSE + userId.toLowerCase()).digest('base64url');
}

export function verifyUnsubscribe(userId: unknown, token: unknown, key: string | null = secret()): boolean {
  if (!key || typeof userId !== 'string' || typeof token !== 'string') return false;
  if (!UUID.test(userId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expected = Buffer.from(signUnsubscribe(userId, key));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The page a person lands on from the link in the email body. */
export function unsubscribePageUrl(userId: string): string {
  const q = new URLSearchParams({ u: userId, t: signUnsubscribe(userId) });
  return `${appUrl(STUDIO.meta.url)}/email-preferences?${q.toString()}`;
}

/** The one-click endpoint for List-Unsubscribe (RFC 8058: a POST, no page). */
export function unsubscribeEndpointUrl(userId: string): string {
  const q = new URLSearchParams({ u: userId, t: signUnsubscribe(userId) });
  return `${appUrl(STUDIO.meta.url)}/api/engagement/unsubscribe?${q.toString()}`;
}

/** Mail headers that let Gmail and others show their own Unsubscribe button. */
export function unsubscribeHeaders(userId: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeEndpointUrl(userId)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
