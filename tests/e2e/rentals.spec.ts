import { test, expect } from '@playwright/test';

test.describe('Rental browsing', () => {
  test('home page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page).toHaveTitle(/.+/); // has some title
    await expect(page.locator('body')).toBeVisible();

    // Check no JS errors fired
    expect(errors).toHaveLength(0);
  });

  test('home page renders key sections', async ({ page }) => {
    await page.goto('/');
    // Should have a header
    await expect(page.locator('header').first()).toBeVisible();
    // Should have a footer
    await expect(page.locator('footer')).toBeVisible();
  });

  test('Smart Rentals page loads and shows content', async ({ page }) => {
    await page.goto('/smart-rentals');
    await expect(page).toHaveTitle(/.+/);
    // Should show some headings or rental categories
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('Smart Rentals page has category links or filters', async ({
    page,
  }) => {
    await page.goto('/smart-rentals');
    // Look for category links (cameras-optics, lighting-power, audio, etc.)
    const links = page.locator('a[href*="/smart-rentals/"]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a category navigates to category page', async ({ page }) => {
    await page.goto('/smart-rentals');

    const categoryLink = page.locator('a[href*="/smart-rentals/"]').first();
    if ((await categoryLink.count()) > 0) {
      await categoryLink.click();
      await page.waitForURL(/\/smart-rentals\/.+/, { timeout: 10000 });
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('Smart Productions page loads', async ({ page }) => {
    await page.goto('/smart-production');
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('Smart Productions page has filter or search functionality', async ({
    page,
  }) => {
    await page.goto('/smart-production');
    // Look for filter buttons, search input, or category tabs
    const interactive = page.locator(
      'button, input[type="search"], input[type="text"], [role="tablist"]',
    );
    const count = await interactive.count();
    expect(count).toBeGreaterThan(0);
  });
});
