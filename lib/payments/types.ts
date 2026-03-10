// ─── Payment Provider Abstraction ────────────────────────────────────────────

export type PaymentStatus = 'COMPLETE' | 'FAILED' | 'PENDING';

/** Data needed to create a checkout session / redirect URL. */
export type CheckoutParams = {
  /** Your internal payment/order ID for reconciliation */
  paymentId: string;
  /** Amount in the provider's main currency unit (e.g., ZAR not cents) */
  amount: number;
  /** Human-readable item name (max ~100 chars) */
  itemName: string;
  itemDescription?: string;
  /** Payer's email (for receipts / pre-fill) */
  email?: string;
  /** Where the browser returns on success */
  returnUrl: string;
  /** Where the browser returns on cancel */
  cancelUrl: string;
  /** Up to 5 custom metadata strings for reconciliation */
  metadata?: {
    customStr1?: string;
    customStr2?: string;
    customStr3?: string;
    customStr4?: string;
    customStr5?: string;
  };
};

/** Result of creating a checkout session. */
export type CheckoutResult = {
  /** Full URL to redirect the browser to */
  paymentUrl: string;
};

/** Parsed + validated webhook payload. */
export type WebhookResult = {
  /** Whether the webhook signature and source are valid */
  valid: boolean;
  /** Payment status (only meaningful when valid=true) */
  status: PaymentStatus;
  /** Provider's own payment ID */
  providerPaymentId: string;
  /** Your internal payment ID (m_payment_id / reference) */
  paymentId: string;
  /** Gross amount received */
  amountGross: number;
  /** Raw params for provider-specific logic */
  raw: Record<string, string>;
};

/** Data needed to create a subscription checkout. */
export type SubscriptionCheckoutParams = {
  /** Your internal subscription record ID */
  subscriptionId: string;
  amount: number;
  planName: string;
  planDescription?: string;
  email?: string;
  returnUrl: string;
  cancelUrl: string;
  /** Billing interval for display purposes */
  interval: 'monthly' | 'annual';
  metadata?: {
    customStr1?: string;
    customStr2?: string;
    customStr3?: string;
    customStr4?: string;
  };
};

/**
 * Unified payment provider interface.
 *
 * Each provider implements these methods. The active provider is
 * selected via `PAYMENT_PROVIDER` env var in `lib/payments/index.ts`.
 */
export interface PaymentProvider {
  /** Provider identifier (e.g., 'payfast', 'paystack') */
  readonly name: string;

  /** Whether the provider has valid credentials configured. */
  isConfigured(): boolean;

  /**
   * Build a checkout redirect URL for a one-time payment.
   * Throws if credentials are missing or URL construction fails.
   * Async because some providers (e.g., Paystack) require a server call.
   */
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;

  /**
   * Build a checkout redirect URL for a subscription payment.
   * Throws if credentials are missing or URL construction fails.
   * Async because some providers (e.g., Paystack) require a server call.
   */
  createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<CheckoutResult>;

  /**
   * Validate an incoming webhook request and extract payment data.
   * Handles IP validation, signature verification, and server-to-server
   * validation as needed by the provider.
   */
  validateWebhook(request: {
    ip: string;
    body: string;
    headers: Record<string, string>;
  }): Promise<WebhookResult>;

  /**
   * List of allowed hostnames for this provider's checkout URLs.
   * Used by client-side redirect validation.
   */
  readonly allowedHosts: readonly string[];
}
