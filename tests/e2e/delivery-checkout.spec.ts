import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 4 delivery in the customer flow: the API contracts and auth gates of
 * the delivery endpoints and the checkout, which run without a database.
 *
 * The signed-in flows (quote, approve a changed price, pay, see the delivery
 * on the booking, confirm receipt, request a return pickup) need a renter
 * account with a cart, a payment provider and migration 076, none of which
 * this run has. They are not stubbed here as always-skipped placeholders;
 * their rules are covered by tests/unit/delivery-checkout-*.test.ts and
 * tests/unit/delivery-review-*.test.ts.
 */

async function safeGoto(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    // The assertions decide.
  }
}

const base = (): string => test.info().project.use.baseURL ?? 'http://localhost:3000';
const BOOKING = '11111111-2222-4333-8444-555555555555';

test.describe('Delivery: contracts that need no database', () => {
  test('eligibility asks a signed-out visitor to sign in', async ({ page }) => {
    const res = await page.request.get('/api/delivery/eligibility');
    expect(res.status()).toBe(401);
  });

  test('a quote needs a signed-in renter, even with a spoofed position', async ({ page }) => {
    const res = await page.request.post('/api/delivery/quote', {
      data: { address: { street: '1 Test Road', city: 'Johannesburg' }, contact_name: 'Thandi', contact_phone: '0821234567', window: 'morning', hint: { lat: -26.19, lng: 28.03 } },
      headers: { Origin: base() },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('delivery status and return pickup are the renter’s own only', async ({ page }) => {
    const status = await page.request.get(`/api/delivery/status?booking_id=${BOOKING}`);
    expect(status.status()).toBe(401);
    const pickup = await page.request.post('/api/delivery/return-pickup', { data: { booking_id: BOOKING, action: 'quote', window: 'afternoon' }, headers: { Origin: base() } });
    expect([401, 403]).toContain(pickup.status());
  });

  test('checkout with delivery still needs a signed-in renter', async ({ page }) => {
    const res = await page.request.post('/api/cart/checkout', {
      data: { acceptTerms: true, fulfilment_method: 'delivery', delivery_quote_id: BOOKING, delivery_approved_cents: 1, delivery_lat: -26.19, delivery_lng: 28.03 },
      headers: { Origin: base() },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('confirming a delivered item needs the signed-in renter', async ({ page }) => {
    const res = await page.request.post('/api/delivery/accept', {
      data: { booking_id: BOOKING, items: [{ booking_id: BOOKING, rental_id: BOOKING, outcome: 'accepted' }] },
      headers: { Origin: base() },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('the cart (with its delivery options) stays behind sign-in', async ({ page }) => {
    await safeGoto(page, '/dashboard/cart');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toMatch(/\/login/);
  });
});
