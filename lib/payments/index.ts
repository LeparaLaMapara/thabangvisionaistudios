import type { PaymentProvider } from './types';
import { payfast } from './payfast';
import { paystack } from './paystack';

// Re-export types for convenience
export type {
  PaymentProvider,
  CheckoutParams,
  CheckoutResult,
  SubscriptionCheckoutParams,
  WebhookResult,
  PaymentStatus,
} from './types';

// ─── Provider Registry ───────────────────────────────────────────────────────

const providers: Record<string, PaymentProvider> = {
  payfast,
  paystack,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.PAYMENT_PROVIDER ?? 'payfast').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[payments] Unknown PAYMENT_PROVIDER="${providerName}". Falling back to payfast. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active payment provider, determined by `PAYMENT_PROVIDER` env var.
 * Defaults to PayFast if not set or unrecognized.
 */
export const payments: PaymentProvider = providers[providerName] ?? payfast;
