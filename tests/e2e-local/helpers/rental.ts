/**
 * LOCAL STACK ONLY: the renter's side of a gear order, through the UI.
 */
import { expect, type Browser, type Page } from '@playwright/test';
import { lit, one } from './db';
import { contextFor, newAccount, type Account } from './auth';
import { approveIdInAdmin, submitIdWithoutUpload, verifyPhone } from './flows';
import { uniqueEmail } from './env';

/** Choose dates on the gear page (they live in the URL) and add the item to the cart. */
export async function addToCartAt(page: Page, gear: { category: string; slug: string }, start: string, end: string): Promise<void> {
  await page.goto(`/rentals/${gear.category}/${gear.slug}?start=${start}&end=${end}`);
  await page.getByRole('button', { name: /add to cart and keep browsing/i }).click();
  await expect(page.getByRole('link', { name: /added/i })).toBeVisible();
}

/** From the cart: accept the Terms when asked and press Checkout (lands on the payment page). */
export async function checkoutFromCart(page: Page): Promise<void> {
  await page.goto('/dashboard/cart');
  const pay = page.getByRole('button', { name: /^checkout, r/i });
  await expect(pay).toBeVisible();
  // The Terms box shows until this renter has accepted the current version once.
  const terms = page.getByRole('checkbox', { name: /i agree to the terms/i });
  if (await terms.isVisible().catch(() => false)) await terms.check();
  await expect(pay).toBeEnabled();
  await pay.click();
}

/** A renter who may hire (phone confirmed, ID approved by an admin in the admin UI). */
export async function readyRenter(browser: Browser, admin: Account, label: string, phone: string): Promise<Account> {
  const renter = await newAccount(browser, uniqueEmail(label), 'rent');
  const { context, page } = await contextFor(browser, renter);
  await verifyPhone(page.request, phone);
  await context.close();
  const name = `Journey ${label} ${renter.id.slice(0, 6)}`;
  submitIdWithoutUpload(renter, name);
  const a = await contextFor(browser, admin);
  await approveIdInAdmin(a.page, name, renter.id);
  await a.context.close();
  return renter;
}

/** The order (checkout group) a payment return URL is for. */
export function groupFrom(page: Page, param: 'checkout' | 'order'): string {
  return new URL(page.url()).searchParams.get(param) ?? '';
}

export interface IntentRow {
  checkout_group_id: string;
  reference: string;
  state: string;
  expected_amount_cents: number;
  hire_cents: number;
  deposit_cents: number;
  delivery_cents: number;
}

export function intentFor(group: string): IntentRow | undefined {
  return one<IntentRow>(`select checkout_group_id::text, reference, state, expected_amount_cents, hire_cents, deposit_cents, delivery_cents
                           from rental_payment_intents where checkout_group_id = ${lit(group)}`);
}
