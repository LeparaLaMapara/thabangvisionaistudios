import {
  isPayFastConfigured,
  buildPaymentData,
  getPayFastUrl,
  isPayFastIP,
  validateSignature,
  validateITN,
} from '@/lib/payfast';
import type {
  PaymentProvider,
  CheckoutParams,
  CheckoutResult,
  SubscriptionCheckoutParams,
  WebhookResult,
  PaymentStatus,
} from './types';

// ─── PayFast Provider ────────────────────────────────────────────────────────

export const payfast: PaymentProvider = {
  name: 'payfast',

  allowedHosts: ['sandbox.payfast.co.za', 'www.payfast.co.za'],

  async refund(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'PayFast refunds are made in the PayFast dashboard' };
  },

  isConfigured() {
    return isPayFastConfigured();
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const paymentData = buildPaymentData({
      amount: params.amount,
      itemName: params.itemName,
      itemDescription: params.itemDescription,
      email: params.email,
      paymentId: params.paymentId,
      returnUrl: params.returnUrl,
      cancelUrl: params.cancelUrl,
      customStr1: params.metadata?.customStr1,
      customStr2: params.metadata?.customStr2,
      customStr3: params.metadata?.customStr3,
      customStr4: params.metadata?.customStr4,
      customStr5: params.metadata?.customStr5,
    });

    const qs = new URLSearchParams(paymentData as Record<string, string>);
    return { paymentUrl: `${getPayFastUrl()}?${qs.toString()}` };
  },

  async createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<CheckoutResult> {
    const paymentData = buildPaymentData({
      amount: params.amount,
      itemName: `${params.planName} Plan (${params.interval})`,
      itemDescription: params.planDescription ?? `${params.planName} subscription — billed ${params.interval}`,
      email: params.email,
      paymentId: params.subscriptionId,
      returnUrl: params.returnUrl,
      cancelUrl: params.cancelUrl,
      customStr1: params.metadata?.customStr1,
      customStr2: params.metadata?.customStr2,
      customStr3: params.metadata?.customStr3,
      customStr4: params.metadata?.customStr4,
    });

    const qs = new URLSearchParams(paymentData as Record<string, string>);
    return { paymentUrl: `${getPayFastUrl()}?${qs.toString()}` };
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

    // 0. Fail closed without a passphrase: PayFast's MD5 signature is only a
    //    secret check when a passphrase is mixed in. Without one anyone with
    //    their own PayFast account could sign a notice for our references.
    if (!process.env.PAYFAST_PASSPHRASE) {
      console.error('[PayFast] Webhook refused: PAYFAST_PASSPHRASE is not set');
      return invalid;
    }

    // 1. IP check
    if (!isPayFastIP(request.ip)) {
      console.error(`[PayFast] Webhook from unauthorized IP: ${request.ip}`);
      return invalid;
    }

    // 2. Parse form-encoded body
    const params: Record<string, string> = {};
    new URLSearchParams(request.body).forEach((value, key) => {
      params[key] = value;
    });

    // 2b. The notice must be for OUR merchant account, not another PayFast
    //     merchant pointing its notify_url at us.
    if (!process.env.PAYFAST_MERCHANT_ID || params.merchant_id !== process.env.PAYFAST_MERCHANT_ID) {
      console.error('[PayFast] Webhook for another merchant account refused');
      return invalid;
    }

    // 3. Signature check
    const receivedSignature = params.signature ?? '';
    if (!validateSignature(params, receivedSignature)) {
      console.error('[PayFast] Signature validation failed');
      return invalid;
    }

    // 4. Server-to-server validation
    const isValid = await validateITN(params);
    if (!isValid) {
      console.error('[PayFast] Server validation failed');
      return invalid;
    }

    return {
      valid: true,
      status: params.payment_status as PaymentStatus,
      providerPaymentId: params.pf_payment_id ?? '',
      paymentId: params.m_payment_id ?? '',
      amountGross: parseFloat(params.amount_gross ?? '0'),
      // PayFast settles in rand only and its ITN carries no currency field.
      // Say so explicitly, so shared checks that compare the currency (e.g.
      // confirmSubscriptionPayment) do not reject every paid PayFast ITN.
      raw: { ...params, currency: params.currency ?? 'ZAR' },
    };
  },
};
