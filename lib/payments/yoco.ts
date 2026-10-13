import crypto from 'crypto';
import { appUrl } from '@/lib/app-url';
import type {
  PaymentProvider,
  CheckoutParams,
  CheckoutResult,
  SubscriptionCheckoutParams,
  WebhookResult,
} from './types';

/**
 * Yoco Checkout API (https://developer.yoco.com).
 *
 * - Checkout: POST /api/checkouts, amount in cents, returns { id, redirectUrl }.
 *   The checkout id ("ch_...") is the reference we keep: refunds go to
 *   POST /api/checkouts/{id}/refund.
 * - Webhooks are signed the Standard Webhooks way: HMAC-SHA256 over
 *   "{webhook-id}.{webhook-timestamp}.{body}" with the base64 secret after the
 *   "whsec_" prefix; the header holds space-separated "v1,<base64>" entries.
 * - Yoco has no payouts API, so creator payouts stay on Paystack.
 * - There is no documented "get checkout" call, so a Yoco payment is confirmed
 *   only by its signed webhook (see lib/payments/confirmations.ts).
 */

const YOCO_API = 'https://payments.yoco.com/api';
const TOLERANCE_SECONDS = 180;

function getSecretKey(): string {
  const key = process.env.YOCO_SECRET_KEY;
  if (!key) throw new Error('YOCO_SECRET_KEY is not configured');
  return key;
}

function resolveUrl(path: string): string {
  if (path.startsWith('http')) return path;
  const base = appUrl();
  return `${base}${path}`;
}

/** True for a reference that belongs to Yoco (a checkout id). */
export function isYocoReference(reference: string | null | undefined): boolean {
  return typeof reference === 'string' && reference.startsWith('ch_');
}

/** Verifies a Standard Webhooks signature. Pure, so it is tested. */
export function verifyYocoSignature(params: {
  id: string;
  timestamp: string;
  body: string;
  signatureHeader: string;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const { id, timestamp, body, signatureHeader, secret } = params;
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const ts = Number(timestamp);
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  const expectedBuf = Buffer.from(expected);

  return signatureHeader.split(' ').some((entry) => {
    const sig = entry.includes(',') ? entry.split(',')[1] : entry;
    const given = Buffer.from(sig ?? '');
    return given.length === expectedBuf.length && crypto.timingSafeEqual(given, expectedBuf);
  });
}

type YocoEvent = {
  id?: string;
  type?: string;
  payload?: {
    id?: string;
    amount?: number;
    currency?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  };
};

export const yoco: PaymentProvider = {
  name: 'yoco',

  allowedHosts: ['c.yoco.com', 'pay.yoco.com', 'payments.yoco.com'],

  isConfigured(): boolean {
    if (process.env.PAYMENTS_OFF === 'true') return false;
    return Boolean(process.env.YOCO_SECRET_KEY);
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const res = await fetch(`${YOCO_API}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `checkout-${params.paymentId}`,
      },
      body: JSON.stringify({
        amount: Math.round(params.amount * 100),
        currency: 'ZAR',
        successUrl: resolveUrl(params.returnUrl),
        cancelUrl: resolveUrl(params.cancelUrl),
        failureUrl: resolveUrl(params.cancelUrl),
        externalId: params.paymentId,
        // The same keys the Paystack path uses, so one fulfilment handles both.
        metadata: {
          payment_id: params.paymentId,
          item_name: params.itemName,
          ...Object.fromEntries(Object.entries(params.metadata ?? {}).filter(([, v]) => v !== undefined)),
        },
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { redirectUrl?: string; id?: string; message?: string };
    if (!res.ok || !data.redirectUrl) {
      throw new Error(`Yoco checkout failed (${res.status}): ${data.message ?? 'no redirect URL'}`);
    }
    return { paymentUrl: data.redirectUrl };
  },

  async createSubscriptionCheckout(_params: SubscriptionCheckoutParams): Promise<CheckoutResult> {
    throw new Error('Yoco does not support subscriptions; use Paystack for plans');
  },

  async validateWebhook(request): Promise<WebhookResult> {
    const invalid: WebhookResult = { valid: false, status: 'FAILED', providerPaymentId: '', paymentId: '', amountGross: 0, raw: {} };

    const ok = verifyYocoSignature({
      id: request.headers['webhook-id'] ?? '',
      timestamp: request.headers['webhook-timestamp'] ?? '',
      body: request.body,
      signatureHeader: request.headers['webhook-signature'] ?? '',
      secret: process.env.YOCO_WEBHOOK_SECRET ?? '',
    });
    if (!ok) {
      console.error('[Yoco] Webhook signature verification failed');
      return invalid;
    }

    let event: YocoEvent;
    try {
      event = JSON.parse(request.body);
    } catch {
      return invalid;
    }

    const p = event.payload ?? {};
    const meta = p.metadata ?? {};
    const checkoutId = typeof meta.checkoutId === 'string' ? meta.checkoutId : '';
    const amount = (p.amount ?? 0) / 100;

    const raw: Record<string, string> = {
      event: event.type ?? '',
      reference: checkoutId,
      yoco_payment_id: p.id ?? '',
      amount: String(amount),
      currency: p.currency ?? 'ZAR',
      status: p.status ?? '',
    };
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === 'string') raw[k] = v;
    }

    const type = event.type ?? '';
    const status = type === 'payment.succeeded' ? 'COMPLETE' : type === 'payment.failed' ? 'FAILED' : 'PENDING';

    return {
      valid: true,
      status,
      // The checkout id is what a refund needs, so it is the reference we keep.
      providerPaymentId: checkoutId,
      paymentId: raw.payment_id ?? '',
      amountGross: amount,
      raw,
    };
  },

  async refund(reference: string, amount?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${YOCO_API}/checkouts/${encodeURIComponent(reference)}/refund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getSecretKey()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `refund-${reference}-${amount ?? 'full'}-${Date.now().toString(36)}`,
        },
        body: JSON.stringify(amount ? { amount: Math.round(amount * 100) } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
      if (!res.ok) return { success: false, error: data.message ?? `Refund failed (${res.status})` };
      return { success: data.status === 'succeeded' || data.status === 'pending' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Refund failed' };
    }
  },
};
