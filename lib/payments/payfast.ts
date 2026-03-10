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
      raw: params,
    };
  },
};
