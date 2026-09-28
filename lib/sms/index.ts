/**
 * SMS, behind one small interface like payments and email.
 *
 * SMS_PROVIDER:
 *   "smsgate" SMS Gateway for Android (open source, github.com/capcom6/android-sms-gateway):
 *             an Android phone with a SIM sends the messages, so the only cost
 *             is that SIM's SMS bundle. Uses the public relay at api.sms-gate.app
 *             unless SMSGATE_URL points elsewhere. SMSGATE_USERNAME and
 *             SMSGATE_PASSWORD come from the app on the phone.
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

const log: SmsProvider = {
  name: 'log',
  isConfigured: () => process.env.VERCEL_ENV !== 'production',
  async send(to, text) {
    console.log(`[sms:log] to ${to.slice(0, 5)}***: ${text}`);
    return { ok: true };
  },
};

const providers: Record<string, SmsProvider> = { smsgate, log };

export const sms: SmsProvider = providers[(process.env.SMS_PROVIDER ?? 'log').toLowerCase()] ?? log;
