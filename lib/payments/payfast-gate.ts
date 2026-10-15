/**
 * The PayFast webhook is open only while PayFast is the active payment
 * provider (PAYMENT_PROVIDER=payfast). Having PayFast keys configured is not
 * enough: the route would then accept notices while Paystack takes the money.
 */
export function isPayFastWebhookOpen(env: Record<string, string | undefined> = process.env): boolean {
  return (env.PAYMENT_PROVIDER ?? '').trim().toLowerCase() === 'payfast';
}
