/**
 * Phone checks: which channel is on, and confirming a number by an INBOUND
 * WhatsApp message (free on the Meta Cloud API).
 *
 * Flow (docs/operations/whatsapp-setup.md):
 *   1. /api/phone/whatsapp/start stores a one-time code for the signed-in
 *      person and the number they typed (phone_code_store, migration 088, the
 *      same table, TTL and caps as the SMS check) and returns a wa.me link with
 *      "Verify my ThabangVision number: TV-482913" prefilled.
 *   2. They send it from WhatsApp. Meta posts it to /api/webhooks/whatsapp.
 *   3. confirmFromWhatsApp() looks up pending codes for the SENDER's number
 *      (their wa_id, which WhatsApp itself vouches for) and only a code saved
 *      for that same number can match. Then profiles.phone and
 *      phone_verified_at are set with the service role, like /api/phone/verify.
 *
 * WhatsApp codes are hashed with a "wa:" prefix, so a code shown on screen
 * can never be typed into the SMS check (/api/phone/verify), which would
 * "confirm" a number the person does not hold.
 */

import { STUDIO } from '@/lib/constants';
import { sms } from '@/lib/sms';
import { codesMatch, hashCode, normaliseSaMobile, phoneCodeSecret } from '@/lib/sms/phone';
import type { createAdminClient } from '@/lib/supabase/server';

type Env = Record<string, string | undefined>;

export type PhoneVerifyChannel = 'whatsapp' | 'sms' | 'off';

/** The business WhatsApp number as digits for wa.me (from E.164), or null. */
export function whatsappBusinessDigits(env: Env = process.env): string | null {
  const digits = (env.WHATSAPP_BUSINESS_NUMBER ?? '').replace(/[^\d]/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Everything the inbound WhatsApp check needs: webhook token, signing secret and the number to message. */
export function whatsappVerifyReady(env: Env = process.env): boolean {
  return Boolean(
    (env.WHATSAPP_VERIFY_TOKEN ?? '').trim() &&
    (env.WHATSAPP_APP_SECRET ?? '').trim() &&
    whatsappBusinessDigits(env),
  );
}

/**
 * PHONE_VERIFY_CHANNEL=whatsapp|sms picks the channel; it is used only when
 * that channel is fully configured, otherwise phone checks are 'off' (never a
 * silent switch to the other channel). Unset: WhatsApp when ready, else SMS
 * when ready, else 'off'. Both need the code-hashing secret.
 */
export function resolvePhoneVerifyChannel(input: {
  setting: string | undefined;
  whatsappReady: boolean;
  smsReady: boolean;
  secretSet: boolean;
}): PhoneVerifyChannel {
  if (!input.secretSet) return 'off';
  const setting = (input.setting ?? '').trim().toLowerCase();
  if (setting === 'whatsapp') return input.whatsappReady ? 'whatsapp' : 'off';
  if (setting === 'sms') return input.smsReady ? 'sms' : 'off';
  if (setting === 'off') return 'off';
  if (input.whatsappReady) return 'whatsapp';
  if (input.smsReady) return 'sms';
  return 'off';
}

/** The channel for this deployment, from the environment. */
export function currentPhoneVerifyChannel(): PhoneVerifyChannel {
  return resolvePhoneVerifyChannel({
    setting: process.env.PHONE_VERIFY_CHANNEL,
    whatsappReady: whatsappVerifyReady(),
    smsReady: sms.isConfigured(),
    secretSet: Boolean(phoneCodeSecret()),
  });
}

// ─── Codes ─────────────────────────────────────────────────────────────────

/** "482913" -> "TV-482913". */
export function formatWhatsappCode(digits: string): string {
  return `${STUDIO.phoneVerify.codePrefix}-${digits}`;
}

/** The six digits of a "TV-482913" code anywhere in a message, tolerating case, a space or no dash. */
export function extractWhatsappCode(text: string): string | null {
  const prefix = STUDIO.phoneVerify.codePrefix.replace(/[^A-Za-z0-9]/g, '');
  const match = new RegExp(`(?:^|[^A-Za-z0-9])${prefix}[\\s-]?(\\d{6})(?!\\d)`, 'i').exec(text ?? '');
  return match ? match[1] : null;
}

/** Stored hash of a WhatsApp code; the "wa:" prefix keeps it apart from SMS codes. */
export function whatsappCodeHash(digits: string, userId: string, secret: string): string {
  return hashCode(`wa:${digits}`, userId, secret);
}

/** The prefilled message and the wa.me link that opens WhatsApp with it. */
export function whatsappVerifyLink(businessDigits: string, code: string): { text: string; link: string } {
  const text = `${STUDIO.phoneVerify.whatsappMessage} ${code}`;
  return { text, link: `https://wa.me/${businessDigits}?text=${encodeURIComponent(text)}` };
}

/** A WhatsApp id (international digits, no plus) as a normalised SA mobile, or null. */
export function waIdToSaMobile(waId: string): string | null {
  if (!/^\d{6,15}$/.test(waId ?? '')) return null;
  return normaliseSaMobile(`+${waId}`);
}

// ─── Confirming ────────────────────────────────────────────────────────────

export interface PendingCode {
  userId: string;
  phone: string;
  codeHash: string;
  expiresAt: string;
}

/** Storage the confirmation needs; Supabase in production, in memory in tests. */
export interface PhoneVerifyStore {
  /** Unexpired codes saved for this number (normalised SA mobile). */
  pendingForPhone(phone: string, nowIso: string): Promise<PendingCode[]>;
  /** Sets profiles.phone and phone_verified_at (service role; 063 lets it through). */
  markVerified(userId: string, phone: string, atIso: string): Promise<void>;
  /** Deletes that exact pending code; true only for the call that removed it. */
  consume(userId: string, codeHash: string): Promise<boolean>;
}

export type WhatsappConfirmOutcome =
  | { kind: 'no_code' }
  | { kind: 'not_sa_mobile' }
  | { kind: 'no_match' }
  | { kind: 'already_done'; userId: string }
  | { kind: 'confirmed'; userId: string; phone: string };

/**
 * Confirms the number that SENT the message, when it carries a live code that
 * was issued for that same number. Unknown, expired, already used and
 * wrong-number codes are all 'no_match'. Safe to run twice on one message.
 */
export async function confirmFromWhatsApp(
  message: { from: string; body: string },
  deps: { store: PhoneVerifyStore; secret: string; now?: Date },
): Promise<WhatsappConfirmOutcome> {
  const digits = extractWhatsappCode(message.body);
  if (!digits) return { kind: 'no_code' };
  const sender = waIdToSaMobile(message.from);
  if (!sender) return { kind: 'not_sa_mobile' };
  if (!deps.secret) return { kind: 'no_match' };

  const now = deps.now ?? new Date();
  const pending = await deps.store.pendingForPhone(sender, now.toISOString());
  const hit = pending.find(
    (p) =>
      p.phone === sender &&
      new Date(p.expiresAt).getTime() > now.getTime() &&
      codesMatch(whatsappCodeHash(digits, p.userId, deps.secret), p.codeHash),
  );
  if (!hit) return { kind: 'no_match' };

  // Profile first (setting the same values twice is harmless), then the code:
  // if the profile write fails the code stays, and Meta's retry can finish.
  await deps.store.markVerified(hit.userId, sender, now.toISOString());
  const consumed = await deps.store.consume(hit.userId, hit.codeHash);
  return consumed ? { kind: 'confirmed', userId: hit.userId, phone: sender } : { kind: 'already_done', userId: hit.userId };
}

export function supabasePhoneVerifyStore(admin: ReturnType<typeof createAdminClient>): PhoneVerifyStore {
  return {
    async pendingForPhone(phone, nowIso) {
      const { data, error } = await admin
        .from('phone_codes')
        .select('user_id, phone, code_hash, expires_at')
        .eq('phone', phone)
        .gt('expires_at', nowIso)
        .limit(20);
      if (error) throw new Error('phone_codes read failed');
      return ((data ?? []) as Array<{ user_id: string; phone: string; code_hash: string; expires_at: string }>).map((r) => ({
        userId: r.user_id,
        phone: r.phone,
        codeHash: r.code_hash,
        expiresAt: r.expires_at,
      }));
    },
    async markVerified(userId, phone, atIso) {
      const { error } = await admin.from('profiles').update({ phone, phone_verified_at: atIso }).eq('id', userId);
      if (error) throw new Error('profile update failed');
    },
    async consume(userId, codeHash) {
      const { data, error } = await admin.from('phone_codes').delete().eq('user_id', userId).eq('code_hash', codeHash).select('user_id');
      if (error) throw new Error('phone_codes delete failed');
      return Array.isArray(data) && data.length > 0;
    },
  };
}
