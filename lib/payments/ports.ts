import type { IdentityPort, PaymentPort, PayoutPort } from '@/lib/core/ports';
import { paystackIdentity, paystackPayments, paystackPayouts } from './paystack-ports';

/**
 * The active provider for each money port, chosen by PAYMENT_PROVIDER.
 * Routes and workers use these, never a provider module directly, so a
 * second provider is a new adapter plus one line here (Phase 2).
 *
 * Only Paystack implements the Phase 1 ports. With another provider selected,
 * refunds, payouts and bank validation are refused (rejected results), never
 * sent somewhere unexpected.
 */

const provider = (process.env.PAYMENT_PROVIDER ?? 'paystack').toLowerCase();

const unsupported = <T>(): Promise<{ ok: false; kind: 'rejected'; message: string } & { _?: T }> =>
  Promise.resolve({ ok: false, kind: 'rejected', message: `not supported for provider ${provider}` });

export const paymentPort: PaymentPort =
  provider === 'paystack'
    ? paystackPayments
    : { provider, refund: () => unsupported(), listRefunds: () => unsupported(), verifyCharge: () => unsupported() };

export const payoutPort: PayoutPort =
  provider === 'paystack' ? paystackPayouts : { provider, transfer: () => unsupported(), verifyTransfer: () => unsupported() };

export const identityPort: IdentityPort =
  provider === 'paystack' ? paystackIdentity : { provider, validateBankAccount: () => unsupported() };
