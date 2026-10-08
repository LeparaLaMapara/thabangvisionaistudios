import { toCents } from '@/lib/core/pricing/money';

/**
 * Subscription money rules, kept pure so they are tested without a database.
 *
 * Three separate steps:
 * 1. Initiation (app/api/payfast/checkout): the browser names a plan and a
 *    billing interval, nothing else. The server prices it from
 *    subscription_plans and writes a PENDING row recording what it expects:
 *    expected_amount_cents, currency, billing_interval, provider_reference.
 * 2. Confirmation (lib/payments/fulfil.ts): a signed webhook is checked
 *    against that row — amount, currency, reference, plan and user.
 * 3. Fulfilment: a guarded pending → active update, so a repeated webhook
 *    changes nothing. An active row is never re-priced.
 */

export type BillingInterval = 'monthly' | 'annual';

export const SUBSCRIPTION_CURRENCY = 'ZAR';

const ALLOWED_KEYS = new Set(['plan_id', 'billing']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Strict request schema: exactly { plan_id, billing }. Any other key — amount,
 * price, plan_name, discount, currency, commission, anything — is refused, so
 * a browser can never suggest a price.
 */
export function parseSubscriptionCheckoutBody(body: unknown): ParseResult<{ plan_id: string; billing: BillingInterval }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length > 0) {
    return { ok: false, error: `Unexpected field(s): ${extra.join(', ')}. Send only plan_id and billing.` };
  }
  const { plan_id, billing } = body as Record<string, unknown>;
  if (typeof plan_id !== 'string' || !UUID_RE.test(plan_id)) {
    return { ok: false, error: 'plan_id must be a plan id.' };
  }
  if (billing !== 'monthly' && billing !== 'annual') {
    return { ok: false, error: "billing must be 'monthly' or 'annual'." };
  }
  return { ok: true, value: { plan_id, billing } };
}

/** The columns of subscription_plans the server prices from. */
export interface PlanRow {
  id: string;
  name: string | null;
  price: number | string | null;
  currency: string | null;
  interval: string | null;
  is_active: boolean | null;
}

export interface PricedPlan {
  id: string;
  name: string;
  interval: BillingInterval;
  currency: typeof SUBSCRIPTION_CURRENCY;
  amountCents: number;
}

/**
 * Price a plan from its database row. Unknown, inactive, non-ZAR or
 * mis-priced plans are refused. A plan row has one interval; annual billing
 * needs its own annual plan row (there is no annual price column, and the
 * server will not derive one).
 */
export function pricePlan(plan: PlanRow | null, billing: BillingInterval): ParseResult<PricedPlan> {
  if (!plan) return { ok: false, error: 'Unknown plan.' };
  if (plan.is_active !== true) return { ok: false, error: 'This plan is not available.' };
  const currency = (plan.currency ?? SUBSCRIPTION_CURRENCY).toUpperCase();
  if (currency !== SUBSCRIPTION_CURRENCY) return { ok: false, error: 'This plan is not available.' };
  if (plan.interval !== billing) {
    return { ok: false, error: `This plan is not offered with ${billing} billing.` };
  }
  const price = Number(plan.price);
  if (plan.price === null || !Number.isFinite(price) || price < 0) {
    return { ok: false, error: 'This plan is not available.' };
  }
  return {
    ok: true,
    value: {
      id: plan.id,
      name: plan.name ?? 'Plan',
      interval: billing,
      currency: SUBSCRIPTION_CURRENCY,
      amountCents: toCents(price),
    },
  };
}

/** The pending row as written at initiation. */
export interface PendingSubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string | null;
  expected_amount_cents: number | null;
  currency: string | null;
  provider_reference: string | null;
}

/** What the signed webhook says was paid. */
export interface SubscriptionPaymentEvidence {
  /** Our reference echoed back by the provider (WebhookResult.paymentId). */
  reference: string;
  /** Gross amount in rands (WebhookResult.amountGross). */
  amountGross: number;
  currency: string | undefined;
  planId: string | undefined;
  userId: string | undefined;
}

export type ConfirmationDecision =
  | { action: 'activate' }
  | { action: 'already_active' }
  | { action: 'reject'; reason: string };

/**
 * Whether a confirmed payment may activate this subscription. Only a pending
 * row whose stored expectation matches the payment exactly is activated.
 */
export function decideSubscriptionConfirmation(
  sub: PendingSubscriptionRow | null,
  paid: SubscriptionPaymentEvidence,
): ConfirmationDecision {
  if (!sub) return { action: 'reject', reason: 'No subscription for this reference' };
  if (sub.status === 'active') return { action: 'already_active' };
  if (sub.status !== 'pending') return { action: 'reject', reason: `Subscription is ${sub.status ?? 'unknown'}, not pending` };
  if (!sub.provider_reference || sub.provider_reference !== paid.reference) {
    return { action: 'reject', reason: 'Reference does not match' };
  }
  if (sub.expected_amount_cents == null || !Number.isSafeInteger(sub.expected_amount_cents)) {
    return { action: 'reject', reason: 'No expected amount recorded' };
  }
  if (!Number.isFinite(paid.amountGross) || toCents(paid.amountGross) !== sub.expected_amount_cents) {
    return { action: 'reject', reason: `Amount mismatch: expected ${sub.expected_amount_cents} cents, received ${Number.isFinite(paid.amountGross) ? toCents(paid.amountGross) : 'none'}` };
  }
  const paidCurrency = (paid.currency ?? '').toUpperCase();
  if (paidCurrency !== SUBSCRIPTION_CURRENCY || (sub.currency ?? '').toUpperCase() !== SUBSCRIPTION_CURRENCY) {
    return { action: 'reject', reason: `Currency mismatch: received ${paid.currency ?? 'none'}` };
  }
  if (!paid.planId || paid.planId !== sub.plan_id) return { action: 'reject', reason: 'Plan does not match' };
  if (!paid.userId || paid.userId !== sub.user_id) return { action: 'reject', reason: 'User does not match' };
  return { action: 'activate' };
}

/** End of a billing period that starts at `start`. */
export function periodEnd(start: Date, interval: BillingInterval): Date {
  const end = new Date(start);
  if (interval === 'annual') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}
