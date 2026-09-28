/**
 * The only sites the browser may be sent to for payment. Browser-safe (no
 * secrets, no server imports), so pages can check a payment link before
 * redirecting to it. Keep in step with each provider's allowedHosts.
 */
export const PAYMENT_HOSTS: readonly string[] = [
  'sandbox.payfast.co.za',
  'www.payfast.co.za',
  'checkout.paystack.com',
  'c.yoco.com',
  'pay.yoco.com',
  'payments.yoco.com',
];

export function isPaymentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PAYMENT_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}
