// ─── Meta WhatsApp Business Cloud API ───────────────────────────────────────
// Webhook checks and free-form replies for the Cloud API (docs:
// developers.facebook.com/docs/whatsapp/cloud-api). Setup steps for the
// owner: docs/operations/whatsapp-setup.md.
//
//   WHATSAPP_VERIFY_TOKEN     our own random string, typed into Meta's webhook
//                             settings; Meta echoes it in the GET handshake.
//   WHATSAPP_APP_SECRET       the Meta app's App Secret; every webhook POST is
//                             signed with it (X-Hub-Signature-256).
//   WHATSAPP_ACCESS_TOKEN     System User permanent token, for sending replies.
//   WHATSAPP_PHONE_NUMBER_ID  the Cloud API id of the business number (not the
//                             number itself), for sending replies.
//   WHATSAPP_GRAPH_VERSION    optional, defaults to GRAPH_VERSION below.
//
// Free-form text is only delivered inside the 24-hour customer service
// window, which opens when the person messages us; it is not charged.

import crypto from 'crypto';
import type { WhatsAppProvider, WhatsAppMessage, SendWhatsAppOptions } from './types';

export const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = 'https://graph.facebook.com';

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined): string => (v ?? '').trim();

/** Constant-time string compare that never throws on length differences. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * True when X-Hub-Signature-256 ("sha256=<hex>") is the HMAC-SHA256 of the raw
 * request body under the app secret. Missing header, wrong prefix, wrong
 * length or an empty secret all fail.
 */
export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(expected, match[1].toLowerCase());
}

/**
 * Meta's webhook handshake: GET ?hub.mode=subscribe&hub.verify_token=..&hub.challenge=..
 * Returns the challenge to echo back, or null to refuse.
 */
export function metaChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge');
  if (mode !== 'subscribe' || !challenge || !safeEqual(token, verifyToken)) return null;
  // Meta sends a number; anything else is not echoed (no reflected content).
  return /^[0-9A-Za-z_-]{1,128}$/.test(challenge) ? challenge : null;
}

interface MetaPayload {
  object?: unknown;
  entry?: Array<{
    changes?: Array<{
      field?: unknown;
      value?: {
        contacts?: Array<{ wa_id?: unknown; profile?: { name?: unknown } }>;
        messages?: Array<{ from?: unknown; id?: unknown; timestamp?: unknown; type?: unknown; text?: { body?: unknown } }>;
      };
    }>;
  }>;
}

/**
 * The inbound TEXT messages in a webhook payload. Statuses (delivery receipts
 * for our own messages), non-text messages and anything malformed are skipped.
 * `from` is the sender's WhatsApp id: their number in international form,
 * digits only.
 */
export function parseMetaInbound(payload: unknown): WhatsAppMessage[] {
  const p = payload as MetaPayload | null;
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return [];
  const out: WhatsAppMessage[] = [];
  for (const entry of p.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'messages' || !Array.isArray(change.value?.messages)) continue;
      for (const m of change.value.messages) {
        if (m?.type !== 'text' || typeof m.from !== 'string' || typeof m.text?.body !== 'string') continue;
        if (!/^\d{6,15}$/.test(m.from)) continue;
        out.push({
          from: m.from,
          body: m.text.body,
          messageId: typeof m.id === 'string' ? m.id : undefined,
          timestamp: typeof m.timestamp === 'string' ? m.timestamp : undefined,
        });
      }
    }
  }
  return out;
}

/** Webhook side is on: handshake token and signing secret are both set. */
export function metaWebhookConfigured(env: Env = process.env): boolean {
  return Boolean(clean(env.WHATSAPP_VERIFY_TOKEN) && clean(env.WHATSAPP_APP_SECRET));
}

/** Sending side is on: token and phone number id are both set. */
export function metaSendConfigured(env: Env = process.env): boolean {
  return Boolean(clean(env.WHATSAPP_ACCESS_TOKEN) && clean(env.WHATSAPP_PHONE_NUMBER_ID));
}

export const meta: WhatsAppProvider = {
  name: 'meta',

  isConfigured(): boolean {
    return metaWebhookConfigured() && metaSendConfigured();
  },

  async sendMessage(options: SendWhatsAppOptions): Promise<{ success: boolean; messageId?: string }> {
    const token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
    const phoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID);
    if (!token || !/^\d+$/.test(phoneNumberId)) return { success: false };
    const to = options.to.replace(/[^\d]/g, '');
    if (!/^\d{6,15}$/.test(to)) return { success: false };
    const version = /^v\d+\.\d+$/.test(clean(process.env.WHATSAPP_GRAPH_VERSION)) ? clean(process.env.WHATSAPP_GRAPH_VERSION) : GRAPH_VERSION;
    try {
      const res = await fetch(`${GRAPH_BASE}/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: options.body.slice(0, 4096) },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        // Status only: Meta's error body can echo the recipient.
        console.error('[whatsapp/meta] send failed with status', res.status);
        return { success: false };
      }
      const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
      return { success: true, messageId: data.messages?.[0]?.id };
    } catch (err) {
      console.error('[whatsapp/meta] send failed:', err instanceof Error ? err.name : 'unknown');
      return { success: false };
    }
  },

  parseIncoming(body: unknown): WhatsAppMessage | null {
    return parseMetaInbound(body)[0] ?? null;
  },

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    return verifyMetaSignature(body, headers['x-hub-signature-256'], clean(process.env.WHATSAPP_APP_SECRET));
  },
};
