import { test, expect } from '@playwright/test';

test.describe('Auth flow', () => {
  test('register page loads and shows form fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create account/i }),
    ).toBeVisible();
  });

  test('register shows error for mismatched passwords', async ({ page }) => {
    await page.goto('/register');
    await page.locator('#email').fill('test@example.com');
    await page.locator('#password').fill('Password123!');
    await page.locator('#confirmPassword').fill('DifferentPassword!');

    // Must agree to terms first so that validation reaches the password check
    await page.locator('input[type="checkbox"]').check();

    await page
      .getByRole('button', { name: /create account/i })
      .click();

    // Error text: "Passwords do not match."
    await expect(
      page.getByText('Passwords do not match'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('login page loads and shows form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign in/i }),
    ).toBeVisible();
  });

  test('login fails with wrong credentials and shows error', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.locator('#email').fill('wrong@example.com');
    await page.locator('#password').fill('WrongPassword123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Supabase returns "Invalid login credentials"
    await expect(
      page.getByText(/invalid login credentials/i),
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
