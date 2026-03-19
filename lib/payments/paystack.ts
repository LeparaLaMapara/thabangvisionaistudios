import crypto from 'crypto';
import type {
  PaymentProvider,
  CheckoutParams,
  CheckoutResult,
  SubscriptionCheckoutParams,
  WebhookResult,
  PaymentStatus,
} from './types';

// ─── Config ──────────────────────────────────────────────────────────────────

const PAYSTACK_API = 'https://api.paystack.com';

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  return key;
}

function resolveUrl(path: string): string {
  if (path.startsWith('http')) return path;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base}${path}`;
}

// ─── Paystack API helpers ────────────────────────────────────────────────────

type PaystackInitResponse = {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

/**
 * Initialize a Paystack transaction.
 * Docs: https://paystack.com/docs/api/transaction/#initialize
 *
 * Paystack expects amount in kobo/cents (ZAR × 100).
 */
async function initializeTransaction(params: {
  email: string;
  amount: number;
  reference: string;
  callback_url: string;
  metadata: Record<string, unknown>;
  channels?: string[];
}): Promise<PaystackInitResponse> {
  const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.email,
      amount: Math.round(params.amount * 100), // ZAR → cents
      reference: params.reference,
      callback_url: params.callback_url,
      metadata: params.metadata,
      channels: params.channels ?? ['card', 'bank', 'eft'],
      currency: 'ZAR',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[Paystack] Initialize failed:', res.status, text);
    throw new Error('Failed to initialize Paystack transaction');
  }

  const data: PaystackInitResponse = await res.json();

  if (!data.status) {
    console.error('[Paystack] Initialize rejected:', data.message);
    throw new Error(data.message || 'Paystack rejected the transaction');
  }

  return data;
}

// ─── Webhook signature verification ─────────────────────────────────────────

/**
 * Paystack signs webhooks with HMAC SHA-512 using the secret key.
 * The signature is in the `x-paystack-signature` header.
 * Docs: https://paystack.com/docs/payments/webhooks/#verify-event-origin
 */
function verifySignature(body: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha512', getSecretKey())
    .update(body)
    .digest('hex');

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

/**
 * Map Paystack event status to our unified PaymentStatus.
 *
 * Paystack webhook events:
 * - charge.success → COMPLETE
 * - charge.failed  → FAILED
 * - transfer.success, transfer.failed, etc. are not used here
 */
function mapStatus(event: string): PaymentStatus {
  if (event === 'charge.success') return 'COMPLETE';
  if (event === 'charge.failed') return 'FAILED';
  return 'PENDING';
}

// ─── Provider ────────────────────────────────────────────────────────────────

export const paystack: PaymentProvider = {
  name: 'paystack',

  allowedHosts: ['checkout.paystack.com'],

  isConfigured(): boolean {
    return !!(
      process.env.PAYSTACK_SECRET_KEY &&
      process.env.PAYSTACK_PUBLIC_KEY
    );
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    if (!params.email) {
      throw new Error('Paystack requires an email address for checkout');
    }

    const res = await initializeTransaction({
      email: params.email,
      amount: params.amount,
      reference: params.paymentId,
      callback_url: resolveUrl(params.returnUrl),
      metadata: {
        payment_id: params.paymentId,
        item_name: params.itemName,
        item_description: params.itemDescription,
        cancel_url: resolveUrl(params.cancelUrl),
        ...flattenMetadata(params.metadata),
      },
    });

    return { paymentUrl: res.data.authorization_url };
  },

  async createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<CheckoutResult> {
    if (!params.email) {
      throw new Error('Paystack requires an email address for checkout');
    }

    const res = await initializeTransaction({
      email: params.email,
      amount: params.amount,
      reference: params.subscriptionId,
      callback_url: resolveUrl(params.returnUrl),
      metadata: {
        subscription_id: params.subscriptionId,
        plan_name: params.planName,
        interval: params.interval,
        cancel_url: resolveUrl(params.cancelUrl),
        ...flattenMetadata(params.metadata),
      },
    });

    return { paymentUrl: res.data.authorization_url };
  },

  async validateWebhook(request): Promise<WebhookResult> {
    const invalid: WebhookResult = {
      valid: false,
      status: 'FAILED',
      providerPaymentId: '',
      paymentId: '',
      amountGross: 0,
      raw: {},
    };

    // 1. Verify HMAC signature
    const signature = request.headers['x-paystack-signature'] ?? '';
    if (!signature || !verifySignature(request.body, signature)) {
      console.error('[Paystack] Webhook signature verification failed');
      return invalid;
    }

    // 2. Parse JSON body
    let payload: {
      event: string;
      data: {
        id: number;
        reference: string;
        amount: number;
        currency: string;
        status: string;
        metadata?: Record<string, string>;
      };
    };

    try {
      payload = JSON.parse(request.body);
    } catch {
      console.error('[Paystack] Invalid webhook JSON');
      return invalid;
    }

    const { event, data } = payload;

    // 3. Build flat raw params for the webhook handler
    // Map Paystack fields to the same keys the handler expects
    const raw: Record<string, string> = {
      event,
      reference: data.reference,
      paystack_id: String(data.id),
      amount: String(data.amount / 100), // cents → ZAR
      currency: data.currency ?? 'ZAR',
      status: data.status,
    };

    // Forward metadata (custom_str1–5 used by the webhook handler)
    if (data.metadata) {
      for (const [key, value] of Object.entries(data.metadata)) {
        if (typeof value === 'string') {
          raw[key] = value;
        }
      }
    }

    return {
      valid: true,
      status: mapStatus(event),
      providerPaymentId: String(data.id),
      paymentId: data.reference,
      amountGross: data.amount / 100, // cents → ZAR
      raw,
    };
  },
};

// ─── Verify Transaction ──────────────────────────────────────────────────────

/**
 * Verify a Paystack transaction by reference.
 * Docs: https://paystack.com/docs/api/transaction/#verify
 */
export async function verifyPayment(reference: string): Promise<{
  success: boolean;
  amount: number;
  reference: string;
  paidAt: string | null;
  metadata: Record<string, string>;
}> {
  const res = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
    },
  });

  const data = await res.json();

  if (!res.ok || !data.status) {
    return { success: false, amount: 0, reference, paidAt: null, metadata: {} };
  }

  return {
    success: data.data.status === 'success',
    amount: data.data.amount / 100, // cents → ZAR
    reference: data.data.reference,
    paidAt: data.data.paid_at ?? null,
    metadata: data.data.metadata ?? {},
  };
}

// ─── Refunds ─────────────────────────────────────────────────────────────────

/**
 * Refund a Paystack transaction (full or partial).
 * Docs: https://paystack.com/docs/api/refund/#create
 */
export async function refundPayment(reference: string, amount?: number): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const body: Record<string, unknown> = { transaction: reference };
    if (amount) body.amount = Math.round(amount * 100); // ZAR → cents

    const res = await fetch(`${PAYSTACK_API}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || !data.status) {
      return { success: false, error: data.message || 'Refund failed' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Refund failed' };
  }
}

// ─── Transfers (Payouts) ─────────────────────────────────────────────────────

/**
 * Initiate a transfer (payout) to a creator's bank account via Paystack Transfers API.
 * Docs: https://paystack.com/docs/api/transfer/#initiate
 */
export async function initiateTransfer(params: {
  amount: number; // In ZAR (not cents)
  recipientCode: string;
  reason: string;
  reference: string;
}): Promise<{ success: boolean; transferCode?: string; error?: string }> {
  try {
    const res = await fetch(`${PAYSTACK_API}/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(params.amount * 100), // ZAR → cents
        recipient: params.recipientCode,
        reason: params.reason,
        reference: params.reference,
        currency: 'ZAR',
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.status) {
      return { success: false, error: data.message || 'Transfer failed' };
    }

    return { success: true, transferCode: data.data?.transfer_code };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Transfer failed' };
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Flatten metadata object into a flat Record for Paystack's metadata field. */
function flattenMetadata(
  meta?: Record<string, string | undefined>,
): Record<string, string> {
  if (!meta) return {};
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) flat[key] = value;
  }
  return flat;
}
