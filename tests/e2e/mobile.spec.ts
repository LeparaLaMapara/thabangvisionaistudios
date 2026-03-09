import { test, expect } from '@playwright/test';

// All tests in this file run on iPhone 14 (390×844) via the "mobile" project
// in playwright.config.ts. They focus on layout and touch interactions only —
// functional tests are covered by the desktop suite.

// ─── 1. Navigation ────────────────────────────────────────────────────────────

test.describe('Mobile navigation', () => {
  test('hamburger icon is visible, desktop nav is hidden', async ({ page }) => {
    await page.goto('/');

    // Desktop nav uses "hidden lg:flex"
    const desktopNav = page.locator('nav.hidden.lg\\:flex');
    await expect(desktopNav).toBeHidden();

    // Mobile actions container (lg:hidden) with the Menu/X button
    const mobileActions = page.locator('div.lg\\:hidden');
    await expect(mobileActions.first()).toBeVisible();
  });

  test('tapping hamburger opens mobile menu with nav links', async ({ page }) => {
    await page.goto('/');

    // The hamburger is the second button inside the lg:hidden div (after search)
    const hamburger = page.locator('div.lg\\:hidden button').last();
    await hamburger.tap();

    // Mobile menu is a fullscreen overlay with nav links
    await expect(page.getByText('PROJECTS')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('THE LAB')).toBeVisible();
    await expect(page.getByText('SMART RENTALS')).toBeVisible();
    await expect(page.getByText('TOOLS')).toBeVisible();
    await expect(page.getByText('CONTACT', { exact: true })).toBeVisible();
  });

  test('tapping a menu link navigates and closes menu', async ({ page }) => {
    await page.goto('/');

    const hamburger = page.locator('div.lg\\:hidden button').last();
    await hamburger.tap();

    await page.getByText('SMART RENTALS').tap();
    await page.waitForURL(/\/smart-rentals/, { timeout: 10000 });

    // Menu should be closed — PROJECTS link should no longer be visible
    await expect(page.getByText('PROJECTS')).toBeHidden({ timeout: 3000 });
  });
});

// ─── 2. Home Page ─────────────────────────────────────────────────────────────

test.describe('Mobile home page', () => {
  test('hero text is visible and not overflowing', async ({ page }) => {
    await page.goto('/');

    const hero = page.locator('h1').first();
    await expect(hero).toBeVisible();

    // Verify the hero text fits within the viewport width (390px)
    const box = await hero.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 5); // small tolerance
  });

  test('carousel cards are visible at mobile width', async ({ page }) => {
    await page.goto('/');

    // Carousel cards use w-[85vw] on mobile
    const carouselCard = page.locator('.group.cursor-pointer').first();
    if ((await carouselCard.count()) > 0) {
      await expect(carouselCard).toBeVisible();
      const box = await carouselCard.boundingBox();
      expect(box).toBeTruthy();
      // 85vw of 390 = ~331px
      expect(box!.width).toBeGreaterThan(300);
      expect(box!.width).toBeLessThanOrEqual(390);
    }
  });

  test('sections stack vertically', async ({ page }) => {
    await page.goto('/');

    // The page has multiple sections — check they are full width
    const sections = page.locator('section');
    const count = await sections.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 3); i++) {
      const box = await sections.nth(i).boundingBox();
      if (box) {
        // Each section should span the full viewport width
        expect(box.width).toBeGreaterThanOrEqual(385); // ~390 minus scrollbar
      }
    }
  });

  test('CTA buttons are tappable with adequate touch target', async ({ page }) => {
    await page.goto('/');

    // Find CTA links (Browse Equipment, Create Account, etc.)
    const ctas = page.locator('a').filter({ hasText: /browse equipment|explore the lab|initiate project/i });
    const count = await ctas.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await ctas.nth(i).boundingBox();
      if (box) {
        // Min 44px touch target
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

// ─── 3. Smart Rentals ─────────────────────────────────────────────────────────

test.describe('Mobile smart rentals', () => {
  test('category cards stack to single column', async ({ page }) => {
    await page.goto('/smart-rentals');

    // The grid uses grid-cols-1 on mobile
    const cards = page.locator('a[href*="/smart-rentals/"]');
    const count = await cards.count();

    if (count >= 2) {
      const box1 = await cards.nth(0).boundingBox();
      const box2 = await cards.nth(1).boundingBox();

      if (box1 && box2) {
        // Stacked = second card is below the first (not side by side)
        expect(box2.y).toBeGreaterThan(box1.y);
      }
    }
  });

  test('rental cards are full width on mobile', async ({ page }) => {
    await page.goto('/smart-rentals');

    const cards = page.locator('a[href*="/smart-rentals/"]');
    if ((await cards.count()) > 0) {
      const box = await cards.first().boundingBox();
      if (box) {
        // Card should span most of the viewport
        expect(box.width).toBeGreaterThan(300);
      }
    }
  });
});

// ─── 4. Rental Detail ─────────────────────────────────────────────────────────

test.describe('Mobile rental detail', () => {
  test('pricing info does not overflow horizontally', async ({ page }) => {
    await page.goto('/smart-rentals');

    // Navigate to first available detail page
    const link = page.locator('a[href*="/smart-rentals/"]').first();
    if ((await link.count()) > 0) {
      await link.tap();
      await page.waitForLoadState('networkidle');

      // Check no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
    }
  });
});

// ─── 5. Auth ──────────────────────────────────────────────────────────────────

test.describe('Mobile auth forms', () => {
  test('login form is full width with proper touch targets', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.locator('#email');
    await expect(emailInput).toBeVisible();

    const box = await emailInput.boundingBox();
    expect(box).toBeTruthy();
    // Full width: should fill most of viewport
    expect(box!.width).toBeGreaterThan(300);
    // Min 44px touch target height
    expect(box!.height).toBeGreaterThanOrEqual(40);

    const passwordInput = page.locator('#password');
    const pwBox = await passwordInput.boundingBox();
    expect(pwBox).toBeTruthy();
    expect(pwBox!.height).toBeGreaterThanOrEqual(40);
  });

  test('register form is full width with proper touch targets', async ({ page }) => {
    await page.goto('/register');

    const inputs = page.locator('input[type="email"], input[type="password"], input[type="text"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(3); // name, email, password, confirm

    for (let i = 0; i < count; i++) {
      const box = await inputs.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThan(300);
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('submit button is not covered by keyboard area on initial load', async ({ page }) => {
    await page.goto('/login');

    const submitBtn = page.getByRole('button', { name: /sign in/i });
    await expect(submitBtn).toBeVisible();

    const box = await submitBtn.boundingBox();
    expect(box).toBeTruthy();
    // Button should be within the viewport (844px height on iPhone 14)
    expect(box!.y + box!.height).toBeLessThan(844);
  });
});

// ─── 6. Dashboard ─────────────────────────────────────────────────────────────

test.describe('Mobile dashboard', () => {
  test('page is accessible on mobile (redirects to login if unauthenticated)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const url = page.url();
    // Either redirected to login or shows dashboard
    if (url.includes('/login')) {
      // Login form should be mobile-friendly
      const emailInput = page.locator('#email');
      await expect(emailInput).toBeVisible();
      const box = await emailInput.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(300);
    }
  });
});

// ─── 7. Ubunye AI Studio ──────────────────────────────────────────────────────

test.describe('Mobile Ubunye AI', () => {
  test('chat input is visible at bottom of viewport', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');

    const chatInput = page.locator('input[placeholder*="Ask Ubunye"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    const box = await chatInput.boundingBox();
    expect(box).toBeTruthy();
    // Should be in the lower portion of the viewport
    expect(box!.y).toBeGreaterThan(400);
  });

  test('quick action chips are visible and wrap properly', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');

    const chips = page.locator('button').filter({ hasText: /plan a shoot|find gear|hire crew|create assets|get pricing/i });
    const count = await chips.count();
    expect(count).toBe(5);

    // All chips should be visible on screen (wrapping, not overflowing)
    for (let i = 0; i < count; i++) {
      const box = await chips.nth(i).boundingBox();
      if (box) {
        // Chip should not overflow the viewport
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390 + 20); // tolerance for padding
      }
    }
  });

  test('HUD side panels are hidden on mobile', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');

    // HUD corners use "hidden md:block"
    const hudCorners = page.locator('.hidden.md\\:block').first();
    await expect(hudCorners).toBeHidden();

    // Status indicators use "hidden md:flex"
    const statusBar = page.locator('.hidden.md\\:flex');
    if ((await statusBar.count()) > 0) {
      await expect(statusBar.first()).toBeHidden();
    }
  });

  test('no horizontal overflow', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});

// ─── 8. Global Search ─────────────────────────────────────────────────────────

test.describe('Mobile global search', () => {
  test('search modal opens from mobile header icon', async ({ page }) => {
    await page.goto('/');

    // Mobile search button is the first button in the lg:hidden div
    const searchBtn = page.locator('div.lg\\:hidden button').first();
    await searchBtn.tap();

    // Modal should be visible with search input
    const searchInput = page.locator('input[placeholder*="Search productions"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test('search modal fills mobile viewport width', async ({ page }) => {
    await page.goto('/');

    const searchBtn = page.locator('div.lg\\:hidden button').first();
    await searchBtn.tap();

    // Modal uses w-full max-w-2xl mx-4
    const modal = page.locator('.bg-neutral-950.border').first();
    await expect(modal).toBeVisible({ timeout: 3000 });

    const box = await modal.boundingBox();
    expect(box).toBeTruthy();
    // Should fill most of the width (390 - 32px margin = 358px min)
    expect(box!.width).toBeGreaterThan(350);
  });

  test('search results area is scrollable', async ({ page }) => {
    await page.goto('/');

    const searchBtn = page.locator('div.lg\\:hidden button').first();
    await searchBtn.tap();

    // The results container has overflow-y-auto
    const resultsArea = page.locator('.overflow-y-auto.flex-1');
    await expect(resultsArea).toBeVisible({ timeout: 3000 });

    const overflow = await resultsArea.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.overflowY;
    });
    expect(overflow).toBe('auto');
  });
});
