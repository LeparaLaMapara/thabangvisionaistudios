import crypto from 'crypto';

/**
 * South African mobile numbers and one-time codes. Pure, so it is tested.
 */

/** "082 123 4567", "+27 82 123 4567", "27821234567" -> "+27821234567"; null if not a SA mobile. */
export function normaliseSaMobile(input: string): string | null {
  const digits = (input ?? '').replace(/[^\d+]/g, '');
  let local: string;
  if (digits.startsWith('+27')) local = digits.slice(3);
  else if (digits.startsWith('27') && digits.length === 11) local = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 10) local = digits.slice(1);
  else return null;
  // SA mobiles are 9 digits after the country code and start with 6, 7 or 8.
  if (!/^[678]\d{8}$/.test(local)) return null;
  return `+27${local}`;
}

/** "+27821234567" -> "082 *** 4567", for showing without exposing the number. */
export function maskPhone(e164: string): string {
  const local = `0${e164.slice(3)}`;
  return `${local.slice(0, 3)} *** ${local.slice(-4)}`;
}

export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS_PER_HOUR = 3;

/** Caps across accounts: per network (IP) and per phone number, each per hour. */
export const PHONE_LIMITS = {
  sendsPerIpPerHour: 10,
  sendsPerNumberPerHour: 3,
  verifyPerIpPerHour: 30,
  // GET /api/phone/status, polled every few seconds while a WhatsApp check is open.
  statusPerUserPerHour: 600,
} as const;

/**
 * The secret codes are hashed with. PHONE_CODE_SECRET, falling back to the
 * service role key (older deploys). Empty means phone checks stay off rather
 * than hashing with no secret.
 */
export function phoneCodeSecret(): string {
  return (process.env.PHONE_CODE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

export function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Codes are stored hashed with the user id and a server secret, never in the clear. */
export function hashCode(code: string, userId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
}

export function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
