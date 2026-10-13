/**
 * SMS, behind one small interface like payments and email.
 *
 * SMS_PROVIDER:
 *   "smsgate" SMS Gateway for Android (open source, github.com/capcom6/android-sms-gateway):
 *             an Android phone with a SIM sends the messages, so the only cost
 *             is that SIM's SMS bundle. Uses the public relay at api.sms-gate.app
 *             unless SMSGATE_URL points elsewhere. SMSGATE_USERNAME and
 *             SMSGATE_PASSWORD come from the app on the phone.
 *   "bulksms" BulkSMS (bulksms.com), a paid SMS gateway that delivers to every
 *             South African network. Prepared, not switched on (TASK-083):
 *             BULKSMS_TOKEN_ID and BULKSMS_TOKEN_SECRET are an API token made
 *             in the BulkSMS account; credits are bought in advance.
 *   "log"     (default) nothing is sent; the message is written to the server log.
 *             Fine for development; in production it counts as "not configured".
 */

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(to: string, text: string): Promise<{ ok: boolean; error?: string }>;
}

const smsgate: SmsProvider = {
  name: 'smsgate',
  isConfigured: () => Boolean(process.env.SMSGATE_USERNAME && process.env.SMSGATE_PASSWORD),
  async send(to, text) {
    const url = process.env.SMSGATE_URL ?? 'https://api.sms-gate.app/3rdparty/v1/messages';
    const auth = Buffer.from(`${process.env.SMSGATE_USERNAME}:${process.env.SMSGATE_PASSWORD}`).toString('base64');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
      });
      if (!res.ok) return { ok: false, error: `SMS gateway answered ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'SMS gateway unreachable' };
    }
  },
};

/** BulkSMS JSON API. Only an E.164 number (+27...) is sent; anything else is refused. */
export const BULKSMS_URL = 'https://api.bulksms.com/v1/messages';

export const bulksms: SmsProvider = {
  name: 'bulksms',
  isConfigured: () => Boolean(process.env.BULKSMS_TOKEN_ID?.trim() && process.env.BULKSMS_TOKEN_SECRET?.trim()),
  async send(to, text) {
    const id = process.env.BULKSMS_TOKEN_ID?.trim();
    const secret = process.env.BULKSMS_TOKEN_SECRET?.trim();
    if (!id || !secret) return { ok: false, error: 'BulkSMS is not configured' };
    if (!/^\+[1-9][0-9]{7,14}$/.test(to)) return { ok: false, error: 'not an international phone number' };
    const auth = Buffer.from(`${id}:${secret}`).toString('base64');
    try {
      const res = await fetch(BULKSMS_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        // Long text is split into parts by BulkSMS (and charged per part): keep messages short.
        body: JSON.stringify([{ to, body: text.slice(0, 459) }]),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return { ok: false, error: `BulkSMS answered ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'BulkSMS unreachable' };
    }
  },
};

const log: SmsProvider = {
  name: 'log',
  isConfigured: () => process.env.VERCEL_ENV !== 'production',
  async send(to, text) {
    console.log(`[sms:log] to ${to.slice(0, 5)}***: ${text}`);
    return { ok: true };
  },
};

const providers: Record<string, SmsProvider> = { smsgate, bulksms, log };

export const sms: SmsProvider = providers[(process.env.SMS_PROVIDER ?? 'log').toLowerCase()] ?? log;
