import { test, expect } from '@playwright/test';

/**
 * Phase 3 supply side (spec 9.3): owners listing gear, photo first.
 *
 * What runs here needs no database or AI: the signed-out behaviour of the
 * new pages and routes. The signed-in flow (photo, suggested details,
 * pre-check, submit) needs a real Supabase session, storage uploads and the
 * vision model, so it is covered by unit tests instead
 * (tests/unit/listing-photo-first.test.ts, listing-suggest.test.ts) and the
 * tests below that need a session are skipped with the reason.
 */

const signedIn = Boolean(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe('owner listings: signed out', () => {
  test('/dashboard/listings sends a signed-out visitor to log in', async ({ page }) => {
    await page.goto('/dashboard/listings');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator('#email')).toBeVisible();
  });

  test('the "List my gear" landing (/dashboard/listings?new=1) also asks to log in first', async ({ page }) => {
    await page.goto('/dashboard/listings?new=1');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator('#email')).toBeVisible();
  });

  test('/welcome asks a signed-out visitor to log in', async ({ page }) => {
    await page.goto('/welcome');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    // /welcome is never a sign-in destination (sign-in returns there by itself
    // when terms acceptance is missing), so no next= points back to it.
    expect(page.url()).not.toContain('welcome');
  });

  test('/dashboard/portfolio sends a signed-out visitor to log in', async ({ page }) => {
    await page.goto('/dashboard/portfolio');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator('#email')).toBeVisible();
  });

  test('the pre-check route refuses a signed-out caller', async ({ request }) => {
    const res = await request.get('/api/listings/00000000-0000-0000-0000-000000000000/check');
    expect(res.status()).toBe(401);
  });
});

test.describe('owner listings: signed in', () => {
  test.skip(!signedIn, 'Needs a real Supabase session (E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD) and a database; covered by unit tests.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(process.env.E2E_OWNER_EMAIL as string);
    await page.locator('#password').fill(process.env.E2E_OWNER_PASSWORD as string);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/(dashboard|welcome|onboarding)/, { timeout: 20_000 });
  });

  test('welcome offers "List my gear" and "Offer my services" separately', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByRole('button', { name: /list my gear/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /offer my services/i })).toBeVisible();
  });

  test('a new listing starts with the photo', async ({ page }) => {
    await page.goto('/dashboard/listings?new=1');
    await expect(page.getByText(/1\. Photo/)).toBeVisible();
    await expect(page.getByRole('button', { name: /suggest details from photo/i })).toBeDisabled();
    await expect(page.getByLabel(/add photo/i)).toBeAttached();
  });
});
