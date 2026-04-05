// ─── Twilio WhatsApp Provider ───────────────────────────────────────────────
// Implements WhatsApp messaging via Twilio's WhatsApp Business API.
// Docs: https://www.twilio.com/docs/whatsapp

import crypto from 'crypto';
import type { WhatsAppProvider, WhatsAppMessage, SendWhatsAppOptions } from './types';

function getAccountSid(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (!sid) throw new Error('TWILIO_ACCOUNT_SID is not configured');
  return sid;
}

function getAuthToken(): string {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) throw new Error('TWILIO_AUTH_TOKEN is not configured');
  return token;
}

function getWhatsAppNumber(): string {
  return process.env.TWILIO_WHATSAPP_NUMBER ?? '';
}

export const twilio: WhatsAppProvider = {
  name: 'twilio',

  isConfigured(): boolean {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_NUMBER
    );
  },

  async sendMessage(options: SendWhatsAppOptions): Promise<{ success: boolean; messageId?: string }> {
    const accountSid = getAccountSid();
    const authToken = getAuthToken();
    const from = getWhatsAppNumber();

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const params = new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${options.to}`,
      Body: options.body,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[whatsapp/twilio] Send failed:', res.status, text);
      return { success: false };
    }

    const data = await res.json();
    return { success: true, messageId: data.sid };
  },

  parseIncoming(body: unknown): WhatsAppMessage | null {
    // Twilio sends form-encoded data; expect parsed object
    const params = body as Record<string, string>;

    if (!params?.Body || !params?.From) return null;

    // Strip 'whatsapp:' prefix from phone number
    const from = params.From.replace('whatsapp:', '');

    return {
      from,
      body: params.Body,
      profileName: params.ProfileName || undefined,
      messageId: params.MessageSid || undefined,
      timestamp: new Date().toISOString(),
    };
  },

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-twilio-signature'] ?? '';
    if (!signature) return false;

    const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('[whatsapp/twilio] TWILIO_WEBHOOK_URL not set — skipping signature validation');
      return true;
    }

    // Sort params and build validation string
    const params = Object.fromEntries(new URLSearchParams(body));
    const sortedKeys = Object.keys(params).sort();
    let dataString = webhookUrl;
    for (const key of sortedKeys) {
      dataString += key + params[key];
    }

    const computed = crypto
      .createHmac('sha1', getAuthToken())
      .update(dataString)
      .digest('base64');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  },
};
