import type { PaymentProvider } from './types';
import { payfast } from './payfast';
import { paystack } from './paystack';
import { yoco } from './yoco';

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
  yoco,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.PAYMENT_PROVIDER ?? 'paystack').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[payments] Unknown PAYMENT_PROVIDER="${providerName}". Falling back to paystack. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active payment provider, determined by `PAYMENT_PROVIDER` env var.
 * Defaults to PayFast if not set or unrecognized.
 */
export const payments: PaymentProvider = providers[providerName] ?? paystack;
