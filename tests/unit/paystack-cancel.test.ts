import { describe, it, expect, vi, afterEach } from 'vitest';

// Paystack sends a customer who abandons its payment page to
// metadata.cancel_action (https://paystack.com/docs/payments/metadata/).
describe('Paystack checkout sends the cancel address where Paystack reads it', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('createCheckout puts the cancel URL in metadata.cancel_action', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { authorization_url: 'https://checkout.paystack.com/x', access_code: 'ac' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { paystack } = await import('@/lib/payments/paystack');
    await paystack.createCheckout({
      paymentId: 'TV-1', amount: 100, itemName: 'Hire', itemDescription: 'Hire', email: 'renter@example.invalid',
      returnUrl: 'https://example.invalid/back', cancelUrl: 'https://example.invalid/dashboard/cart?payment=cancelled', metadata: { customStr1: 'x' },
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.metadata.cancel_action).toBe('https://example.invalid/dashboard/cart?payment=cancelled');
  });
});
