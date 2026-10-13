/**
 * Facts the legal pages state that come from configuration rather than from
 * constants, read in one place so the pages never contradict the running
 * system. Server only (it reads the payment provider configuration).
 */
import { payments } from '@/lib/payments';
import { onlinePaymentsOpen } from '@/lib/payments/status';

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  paystack: 'Paystack',
  yoco: 'Yoco',
  payfast: 'PayFast',
};

/** The display name of the payment provider new checkouts go to (PAYMENT_PROVIDER). */
export function activePaymentProviderLabel(): string {
  return PAYMENT_PROVIDER_LABELS[payments.name] ?? payments.name;
}

/** Whether customers can pay online right now (the provider is configured with live keys). */
export function paymentsOpenForLegalPages(): boolean {
  try {
    return onlinePaymentsOpen();
  } catch {
    return false;
  }
}

/**
 * AI providers the model registry can route to (lib/ai/registry.ts PROVIDERS,
 * plus Google's vision API used by lib/agents/tools). Which of them actually
 * answers depends on configuration and availability, so the pages say
 * "may include". A self-hosted endpoint (AI_LOCAL_BASE_URL) is ours, not a
 * third party, and is not listed.
 */
export const AI_PROVIDERS_DISCLOSED = ['Google (Gemini and Gemma)', 'Anthropic (Claude)', 'OpenAI', 'Groq'] as const;

/** "A, B, C and D" */
export function listInProse(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
