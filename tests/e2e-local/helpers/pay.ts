/**
 * LOCAL STACK ONLY: the browser side of the fake Paystack checkout.
 * The stub (harness/stub.mjs) hands out https://checkout.paystack.com links,
 * the only payment host the app will send a browser to; these helpers route
 * that host to the stub inside the test browser.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { STUB } from './env';

const CHECKOUT_HOST = 'https://checkout.paystack.com';

export async function routeCheckoutToStub(context: BrowserContext): Promise<void> {
  await context.route(`${CHECKOUT_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${STUB}${url.pathname}${url.search}`, maxRedirects: 0 });
    await route.fulfill({ response });
  });
}

/** On the stub checkout page: the reference it is for. */
export function referenceOnCheckout(page: Page): string {
  const m = new URL(page.url()).pathname.match(/^\/checkout\/([^/]+)/);
  if (!m) throw new Error(`Not on the stub checkout: ${page.url()}`);
  return decodeURIComponent(m[1]);
}

/** Pay on the stub page (optionally without the webhook) and wait for the app's return page. */
export async function payOnStub(page: Page, opts: { skipWebhook?: boolean } = {}): Promise<string> {
  await expect(page).toHaveURL(/checkout\.paystack\.com\/checkout\//);
  const reference = referenceOnCheckout(page);
  const pay = `${CHECKOUT_HOST}/checkout/${encodeURIComponent(reference)}/pay${opts.skipWebhook ? '?webhook=skip' : ''}`;
  await page.goto(pay);
  await page.waitForURL((u) => u.host === 'localhost:3000', { timeout: 30_000 });
  return reference;
}

/** Abandon on the stub page and wait for the app's cancel page. */
export async function cancelOnStub(page: Page): Promise<string> {
  await expect(page).toHaveURL(/checkout\.paystack\.com\/checkout\//);
  const reference = referenceOnCheckout(page);
  await page.locator('#cancel').click();
  await page.waitForURL((u) => u.host === 'localhost:3000', { timeout: 30_000 });
  return reference;
}
