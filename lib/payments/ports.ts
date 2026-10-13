import type { IdentityPort, PaymentPort, PayoutPort } from '@/lib/core/ports';
import {
  NO_PAYMENT_CAPABILITIES,
  NO_PAYOUT_CAPABILITIES,
  selectPaymentAdapter,
  selectPayoutAdapter,
  type PaymentNeed,
  type PayoutNeed,
  type Selection,
} from '@/lib/core/payments/capabilities';
import { paystackIdentity, paystackPayments, paystackPayouts } from './paystack-ports';

/**
 * The active provider for each money port, chosen by PAYMENT_PROVIDER.
 * Routes and workers use these, never a provider module directly, so a
 * second provider is a new adapter plus one entry in the lists below.
 *
 * Each adapter declares its capabilities (spec §8.4). A caller that needs a
 * capability asks for it (`paymentAdapterFor`, `payoutAdapterFor`); when no
 * adapter has it the action is refused, never done another way, so business
 * policy does not change with the provider.
 *
 * Only Paystack implements the money ports today. With another provider
 * selected, refunds, payouts and bank validation are refused (rejected
 * results, no capabilities), never sent somewhere unexpected.
 */

const provider = (process.env.PAYMENT_PROVIDER ?? 'paystack').toLowerCase();

const unsupported = <T>(): Promise<{ ok: false; kind: 'rejected'; message: string } & { _?: T }> =>
  Promise.resolve({ ok: false, kind: 'rejected', message: `not supported for provider ${provider}` });

export const paymentPort: PaymentPort =
  provider === 'paystack'
    ? paystackPayments
    : { provider, capabilities: NO_PAYMENT_CAPABILITIES, refund: () => unsupported(), listRefunds: () => unsupported(), verifyCharge: () => unsupported() };

export const payoutPort: PayoutPort =
  provider === 'paystack'
    ? paystackPayouts
    : { provider, capabilities: NO_PAYOUT_CAPABILITIES, transfer: () => unsupported(), verifyTransfer: () => unsupported() };

export const identityPort: IdentityPort =
  provider === 'paystack' ? paystackIdentity : { provider, validateBankAccount: () => unsupported() };

/** Adapters in order of preference: the configured provider first. */
const paymentAdapters: readonly PaymentPort[] = [paymentPort];
const payoutAdapters: readonly PayoutPort[] = [payoutPort];

const ZA = { currency: 'ZAR', country: 'ZA' } as const;

export function paymentAdapterFor(needs: readonly PaymentNeed[], ctx = ZA): Selection<PaymentPort> {
  return selectPaymentAdapter(paymentAdapters, needs, ctx);
}

export function payoutAdapterFor(needs: readonly PayoutNeed[], ctx = ZA): Selection<PayoutPort> {
  return selectPayoutAdapter(payoutAdapters, needs, ctx);
}
