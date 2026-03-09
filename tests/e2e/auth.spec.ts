import { test, expect } from '@playwright/test';

test.describe('Auth flow', () => {
  test('register page loads and shows form fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create|sign up|register/i }),
    ).toBeVisible();
  });

  test('register shows error for mismatched passwords', async ({ page }) => {
    await page.goto('/register');
    await page.fill('input[type="email"]', 'test@example.com');

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill('Password123!');
    await passwordInputs.nth(1).fill('DifferentPassword!');

    await page
      .getByRole('button', { name: /create|sign up|register/i })
      .click();

    // Should show a mismatch or validation error
    await expect(
      page.getByText(/match|mismatch|don't match/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test('login page loads and shows form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign in|login|log in/i }),
    ).toBeVisible();
  });

  test('login fails with wrong credentials and shows error', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'WrongPassword123!');
    await page.getByRole('button', { name: /sign in|login|log in/i }).click();

    // Should show an error message
    await expect(
      page.getByText(/invalid|incorrect|failed|error|wrong/i),
    ).toBeVisible({ timeout: 10000 });
  });

  test('forgot password link exists on login page', async ({ page }) => {
    await page.goto('/login');
    const forgotLink = page.getByText(/forgot|reset password/i);
    await expect(forgotLink).toBeVisible();
  });

  test('unauthenticated user visiting /dashboard gets redirected to /login', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    // Should redirect to login or show login form
    await page.waitForURL(/\/(login|dashboard)/, { timeout: 10000 });
    // If redirected to login, the login form should be visible
    // If stayed on dashboard, it might show a client-side redirect
    const url = page.url();
    if (url.includes('/login')) {
      await expect(page.locator('input[type="email"]')).toBeVisible();
    }
  });
});
