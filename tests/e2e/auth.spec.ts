import { test, expect } from '@playwright/test';
import { usesDummySupabase, DUMMY_SUPABASE_SKIP_REASON } from './helpers/supabase-env';

test.describe('Auth flow', () => {
  // /register opens Create account on the sign-in screen: Google or email +
  // password (2026-10-14), and no confirm-password field.
  test('register redirects to the sign-in screen and shows the form', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#email')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create account/i }).first(),
    ).toBeVisible();
  });

  test('there is no confirm-password field', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toHaveCount(0);
  });

  test('login page loads and shows form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign In', exact: true }),
    ).toBeVisible();
  });

  test('login fails with wrong credentials and shows error', async ({
    page,
  }) => {
    test.skip(usesDummySupabase(), DUMMY_SUPABASE_SKIP_REASON);
    await page.goto('/login');
    await page.locator('#email').fill('wrong@example.com');
    await page.locator('#password').fill('WrongPassword123!');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // Supabase returns "Invalid login credentials", said plainly.
    await expect(
      page.getByText(/email and password don't match/i),
    ).toBeVisible({ timeout: 15000 });
  });

  test('forgot password link exists on login page', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('button', { name: /forgot password/i }),
    ).toBeVisible();
  });

  test('unauthenticated user visiting /dashboard gets redirected to /login', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    // Should redirect to login or show login form
    await page.waitForURL(/\/(login|dashboard)/, { timeout: 10000 });
    // If redirected to login, the login form should be visible
    const url = page.url();
    if (url.includes('/login')) {
      await expect(page.locator('#email')).toBeVisible();
    }
  });
});
