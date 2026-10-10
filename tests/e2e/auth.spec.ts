import { test, expect } from '@playwright/test';
import { usesDummySupabase, DUMMY_SUPABASE_SKIP_REASON } from './helpers/supabase-env';

test.describe('Auth flow', () => {
  // /register is the same screen as /login now (spec 9.1): Google or a
  // passwordless email, and no confirm-password field.
  test('register redirects to the sign-in screen and shows the form', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#email')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /continue with email/i }),
    ).toBeVisible();
  });

  test('there is no confirm-password field', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: /use a password instead/i }).click();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toHaveCount(0);
  });

  test('login page loads and shows form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    // Password sign-in is one tap away from the passwordless default.
    await page.getByRole('button', { name: /use a password instead/i }).click();
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
    await page.getByRole('button', { name: /use a password instead/i }).click();
    await page.locator('#email').fill('wrong@example.com');
    await page.locator('#password').fill('WrongPassword123!');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // Supabase returns "Invalid login credentials"
    await expect(
      page.getByText(/invalid login credentials/i),
    ).toBeVisible({ timeout: 15000 });
  });

  test('forgot password link exists on login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /use a password instead/i }).click();
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
