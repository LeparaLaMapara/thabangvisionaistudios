import type { PaymentCapabilities, PayoutCapabilities } from '@/lib/core/payments/capabilities';
import type { IdentityPort, PaymentPort, PayoutPort, ProviderCallResult, ProviderRefund, ProviderTransfer } from '@/lib/core/ports';
import { PAYSTACK_API } from './paystack';

/**
 * Paystack adapters for the core money ports (lib/core/ports).
 *
 * Every call is classified by what we KNOW happened:
 *   - 2xx with status:true → ok
 *   - 4xx → rejected: Paystack refused it, so nothing moved
 *   - timeout, network error or 5xx → unknown: it may or may not have happened.
 *     Callers reconcile before retrying.
 *
 * Amounts are integer cents in and out (Paystack's ZAR unit is the cent).
 *
 * Field names are read defensively. The live response and webhook shapes for
 * refunds and transfers still have to be confirmed in Paystack test mode
 * (docs/payments/payment-lifecycle.md, "Needs test-mode verification").
 */

const TIMEOUT_MS = 15_000;

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  return key;
}

type Json = Record<string, unknown>;

async function call(method: 'GET' | 'POST', path: string, body?: Json): Promise<ProviderCallResult<Json>> {
  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    return { ok: false, kind: 'unknown', message: err instanceof Error ? err.message : 'network error' };
  }
  let data: Json = {};
  try {
    data = (await res.json()) as Json;
  } catch {
    // Non-JSON body: treat by status code alone.
  }
  const message = typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
  if (res.status >= 500) return { ok: false, kind: 'unknown', message };
  if (!res.ok || data.status !== true) return { ok: false, kind: 'rejected', message };
  return { ok: true, value: data };
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const cents = (v: unknown): number => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : Math.round(n);
};

function toRefund(d: Json): ProviderRefund {
  return { providerRefundId: str(d.id ?? d.refund_reference ?? d.reference), status: str(d.status).toLowerCase(), amountCents: cents(d.amount) };
}

function toTransfer(d: Json): ProviderTransfer {
  return { transferCode: str(d.transfer_code ?? d.id), status: str(d.status).toLowerCase(), amountCents: cents(d.amount) };
}

/**
 * What these adapters implement (not everything Paystack offers): hosted
 * checkout lives in paystack.ts; pre-authorisation, recurring billing and
 * instant (PayShap/RTC) transfers are not implemented or verified here.
 */
export const PAYSTACK_PAYMENT_CAPABILITIES: PaymentCapabilities = {
  cardPayments: true,
  partialRefunds: true,
  cardPreauthorisation: false,
  recurringPayments: false,
  chargeVerification: true,
  refundLookup: true,
  currencies: ['ZAR'],
  countries: ['ZA'],
};

export const PAYSTACK_PAYOUT_CAPABILITIES: PayoutCapabilities = {
  bankTransfers: true,
  instantTransfers: false,
  transferVerification: true,
  currencies: ['ZAR'],
  countries: ['ZA'],
};

export const paystackPayments: PaymentPort = {
  provider: 'paystack',
  capabilities: PAYSTACK_PAYMENT_CAPABILITIES,

  async refund({ transactionReference, amountCents }) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { ok: false, kind: 'rejected', message: 'invalid refund amount' };
    const r = await call('POST', '/refund', { transaction: transactionReference, amount: amountCents, currency: 'ZAR' });
    if (!r.ok) return r;
    return { ok: true, value: toRefund((r.value.data ?? {}) as Json) };
  },

  async listRefunds(transactionReference) {
    const r = await call('GET', `/refund?transaction=${encodeURIComponent(transactionReference)}&perPage=100`);
    if (!r.ok) return r;
    const rows = Array.isArray(r.value.data) ? (r.value.data as Json[]) : [];
    return { ok: true, value: rows.map(toRefund) };
  },

  async verifyCharge(reference) {
    const r = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    if (!r.ok) return r;
    const d = (r.value.data ?? {}) as Json;
    return { ok: true, value: { status: str(d.status).toLowerCase(), amountCents: cents(d.amount), currency: str(d.currency).toUpperCase(), providerTransactionId: str(d.id) } };
  },
};

export const paystackPayouts: PayoutPort = {
  provider: 'paystack',
  capabilities: PAYSTACK_PAYOUT_CAPABILITIES,

  async transfer({ reference, amountCents, recipientCode, reason }) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { ok: false, kind: 'rejected', message: 'invalid transfer amount' };
    const r = await call('POST', '/transfer', { source: 'balance', amount: amountCents, recipient: recipientCode, reason, reference, currency: 'ZAR' });
    if (!r.ok) return r;
    return { ok: true, value: toTransfer((r.value.data ?? {}) as Json) };
  },

  async verifyTransfer(reference) {
    const r = await call('GET', `/transfer/verify/${encodeURIComponent(reference)}`);
    if (!r.ok) {
      // "Transfer not found" is a definite answer: nothing was sent.
      if (r.kind === 'rejected' && /not\s*found/i.test(r.message)) return { ok: true, value: null };
      return r;
    }
    return { ok: true, value: toTransfer((r.value.data ?? {}) as Json) };
  },
};

/**
 * South African bank account validation (POST /bank/validate, South Africa
 * only). Bank validation is not identity verification: it proves an account
 * exists in a name, nothing about the person in front of us.
 */
export const paystackIdentity: IdentityPort = {
  provider: 'paystack',

  async validateBankAccount(p) {
    const r = await call('POST', '/bank/validate', {
      bank_code: p.bankCode,
      country_code: 'ZA',
      account_number: p.accountNumber,
      account_name: p.accountName,
      account_type: p.accountType,
      document_type: p.documentType,
      document_number: p.documentNumber,
    });
    if (!r.ok) return r;
    const d = (r.value.data ?? {}) as Json;
    return { ok: true, value: { verified: d.verified === true, message: str(d.verificationMessage ?? d.message) } };
  },
};
