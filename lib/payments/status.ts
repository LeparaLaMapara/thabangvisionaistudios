import { payments } from '@/lib/payments';

/**
 * Whether a customer can pay online right now. The one switch every page's
 * wording reads: it is the active provider's own isConfigured() (for Paystack,
 * paystackReady refuses test keys in production), so the "not open yet"
 * notices disappear by themselves the day live keys go in. Server only.
 */
export function onlinePaymentsOpen(): boolean {
  return payments.isConfigured();
}
