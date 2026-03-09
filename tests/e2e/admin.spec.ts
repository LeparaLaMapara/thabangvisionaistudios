import { test, expect } from '@playwright/test';

test.describe('Admin area', () => {
  test('admin login page is accessible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('unauthenticated admin access redirects to login', async ({ page }) => {
    await page.goto('/admin');
    // Should either redirect to /login or show auth guard
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const bodyText = await page.textContent('body');

    // Either redirected to login, or shows login/access denied UI
    const isProtected =
      url.includes('/login') ||
      bodyText?.match(/sign in|login|unauthorized|access denied/i) !== null;
    expect(isProtected).toBe(true);
  });

  test('admin/projects is auth-gated', async ({ page }) => {
    await page.goto('/admin/projects');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const bodyText = await page.textContent('body');

    const isProtected =
      url.includes('/login') ||
      bodyText?.match(/sign in|login|unauthorized|access denied/i) !== null;
    expect(isProtected).toBe(true);
  });

  test('admin/rentals is auth-gated', async ({ page }) => {
    await page.goto('/admin/rentals');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const bodyText = await page.textContent('body');

    const isProtected =
      url.includes('/login') ||
      bodyText?.match(/sign in|login|unauthorized|access denied/i) !== null;
    expect(isProtected).toBe(true);
  });

  test('admin/careers is auth-gated', async ({ page }) => {
    await page.goto('/admin/careers');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const bodyText = await page.textContent('body');

    const isProtected =
      url.includes('/login') ||
      bodyText?.match(/sign in|login|unauthorized|access denied/i) !== null;
    expect(isProtected).toBe(true);
  });

  test('admin/press is auth-gated', async ({ page }) => {
    await page.goto('/admin/press');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const bodyText = await page.textContent('body');

    const isProtected =
      url.includes('/login') ||
      bodyText?.match(/sign in|login|unauthorized|access denied/i) !== null;
    expect(isProtected).toBe(true);
  });

  test('admin/bookings is auth-gated', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const bodyText = await page.textContent('body');

    const isProtected =
      url.includes('/login') ||
      bodyText?.match(/sign in|login|unauthorized|access denied/i) !== null;
    expect(isProtected).toBe(true);
  });
});
