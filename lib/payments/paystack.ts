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

// Paystack's API host is api.paystack.co (https://paystack.com/docs/api/).
// Hosted checkout pages are on checkout.paystack.com — a different host.
export const PAYSTACK_API = 'https://api.paystack.co';

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

/**
 * Whether Paystack may take payments here.
 *
 * Only the secret key matters on the server. This used to also require
 * PAYSTACK_PUBLIC_KEY, a variable that was never set (Vercel has
 * NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY), so production always read "not
 * configured". That hid a worse problem: production holds TEST keys, and a
 * test checkout would let anyone confirm a real booking with a test card. So
 * the live site refuses test keys outright; previews and local use them.
 */
export function paystackReady(secretKey: string | undefined, vercelEnv: string | undefined): boolean {
  if (!secretKey) return false;
  if (vercelEnv === 'production' && secretKey.startsWith('sk_test_')) return false;
  return true;
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
export function verifySignature(body: string, signature: string): boolean {
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

  refund: (reference: string, amount?: number) => refundPayment(reference, amount),

  isConfigured(): boolean {
    // PAYMENTS_OFF=true switches online payment off on purpose (the nonprod
    // site uses it to show exactly what production customers see).
    if (process.env.PAYMENTS_OFF === 'true') return false;
    return paystackReady(process.env.PAYSTACK_SECRET_KEY, process.env.VERCEL_ENV);
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

    return { paymentUrl: res.data.authorization_url, accessCode: res.data.access_code };
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

// ─── Transfer recipients ─────────────────────────────────────────────────────

export type TransferRecipientResult =
  | { success: true; recipientCode: string }
  | { success: false; error: string; unreachable?: boolean };

/**
 * Register a South African bank account as a Paystack transfer recipient.
 * Docs: https://paystack.com/docs/transfers/creating-transfer-recipients/
 *
 * South African accounts use type 'basa' (Banking Association South Africa)
 * and currency 'ZAR'; 'nuban' is for Nigerian accounts and is refused for
 * ZAR. Paystack checks the account number against the bank, so this doubles
 * as validation. The account number is sent to Paystack only: it is never
 * logged or returned.
 */
export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<TransferRecipientResult> {
  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_API}/transferrecipient`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'basa',
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: 'ZAR',
      }),
    });
  } catch (err) {
    console.error('[Paystack] transferrecipient request failed:', err instanceof Error ? err.message : 'unknown error');
    return { success: false, error: 'Payment provider unreachable', unreachable: true };
  }

  const data = (await res.json().catch(() => null)) as
    | { status?: boolean; message?: unknown; data?: { recipient_code?: unknown } }
    | null;

  if (res.ok && data?.status && typeof data.data?.recipient_code === 'string') {
    return { success: true, recipientCode: data.data.recipient_code };
  }
  return {
    success: false,
    error: typeof data?.message === 'string' ? data.message : 'Your bank could not verify these details.',
  };
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
