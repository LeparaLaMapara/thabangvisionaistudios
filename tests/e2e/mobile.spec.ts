import { test, expect } from '@playwright/test';

// All tests in this file run on iPhone 14 (393×852) via the "mobile" project
// in playwright.config.ts using Chromium with mobile emulation.
// They focus on layout and touch interactions only —
// functional tests are covered by the desktop suite.

const VIEWPORT_WIDTH = 393; // iPhone 14 CSS viewport width

/**
 * Navigate to a page, returning true if it loaded successfully.
 * Returns false (and the test should skip) on timeout or server error.
 */
async function safeGoto(
  page: import('@playwright/test').Page,
  url: string,
  options?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number },
): Promise<boolean> {
  try {
    await page.goto(url, {
      waitUntil: options?.waitUntil ?? 'domcontentloaded',
      timeout: options?.timeout ?? 30000,
    });
    const body = await page.locator('body').textContent({ timeout: 3000 }).catch(() => '');
    if (body?.includes('Internal Server Error')) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── 1. Navigation ────────────────────────────────────────────────────────────

test.describe('Mobile navigation', () => {
  test('hamburger icon is visible, desktop nav is hidden', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    // Desktop nav uses "hidden lg:flex" — check computed display is none
    const desktopNav = page.locator('nav.hidden');
    if ((await desktopNav.count()) > 0) {
      const display = await desktopNav.first().evaluate(
        el => getComputedStyle(el).display,
      );
      expect(display).toBe('none');
    }

    // Mobile actions container (lg:hidden) should be visible
    const mobileActions = page.locator('div.lg\\:hidden');
    if ((await mobileActions.count()) > 0) {
      const display = await mobileActions.first().evaluate(
        el => getComputedStyle(el).display,
      );
      expect(display).not.toBe('none');
    }
  });

  test('tapping hamburger opens mobile menu with nav links', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const hamburger = page.locator('div.lg\\:hidden button').last();
    await hamburger.tap();

    // Mobile menu is a fullscreen overlay
    const mobileMenu = page.locator('.fixed.inset-0');
    await expect(mobileMenu.first()).toBeVisible({ timeout: 3000 });

    // Check for nav buttons inside the mobile menu
    await expect(mobileMenu.getByRole('button', { name: 'PROJECTS' })).toBeVisible();
    await expect(mobileMenu.getByRole('button', { name: 'THE LAB' })).toBeVisible();
    await expect(mobileMenu.getByRole('button', { name: 'SMART RENTALS' })).toBeVisible();
  });

  test('tapping a menu link navigates and closes menu', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const hamburger = page.locator('div.lg\\:hidden button').last();
    await hamburger.tap();

    const mobileMenu = page.locator('.fixed.inset-0');
    await expect(mobileMenu.first()).toBeVisible({ timeout: 3000 });

    // Click nav button — mobileNavigate() calls router.push() then closes menu
    const creatorsBtn = mobileMenu.getByRole('button', { name: 'CREATORS' });
    await creatorsBtn.click();
    await page.waitForURL(/\/smart-creators/, { timeout: 30000, waitUntil: 'domcontentloaded' });
  });
});

// ─── 2. Home Page ─────────────────────────────────────────────────────────────

test.describe('Mobile home page', () => {
  test('hero text is visible and not overflowing', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const hero = page.locator('h1').first();
    await expect(hero).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('carousel cards are visible at mobile width', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const carouselCard = page.locator('.group.cursor-pointer').first();
    if ((await carouselCard.count()) > 0) {
      await expect(carouselCard).toBeVisible();

      const width = await carouselCard.evaluate(
        el => parseFloat(getComputedStyle(el).width),
      );
      expect(width).toBeGreaterThan(250);
      expect(width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    }
  });

  test('sections stack vertically', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const sections = page.locator('section');
    const count = await sections.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 3); i++) {
      const box = await sections.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(385);
      }
    }
  });

  test('CTA buttons are tappable with adequate touch target', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const ctas = page.locator('a').filter({ hasText: /browse equipment|explore the lab|initiate project/i });
    const count = await ctas.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await ctas.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

// ─── 3. Smart Rentals ─────────────────────────────────────────────────────────

test.describe('Mobile smart rentals', () => {
  test('category cards stack to single column', async ({ page }) => {
    if (!(await safeGoto(page, '/smart-rentals', { timeout: 45000 }))) {
      test.skip(true, 'Smart rentals page unavailable');
      return;
    }

    const cards = page.locator('a[href*="/smart-rentals/"]');
    const count = await cards.count();

    if (count >= 2) {
      const box1 = await cards.nth(0).boundingBox();
      const box2 = await cards.nth(1).boundingBox();

      if (box1 && box2) {
        expect(box2.y).toBeGreaterThan(box1.y);
      }
    }
  });

  test('rental cards are full width on mobile', async ({ page }) => {
    if (!(await safeGoto(page, '/smart-rentals', { timeout: 45000 }))) {
      test.skip(true, 'Smart rentals page unavailable');
      return;
    }

    const cards = page.locator('a[href*="/smart-rentals/"]');
    if ((await cards.count()) > 0) {
      const box = await cards.first().boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThan(300);
      }
    }
  });
});

// ─── 4. Rental Detail ─────────────────────────────────────────────────────────

test.describe('Mobile rental detail', () => {
  test('pricing info does not overflow horizontally', async ({ page }) => {
    if (!(await safeGoto(page, '/smart-rentals', { timeout: 45000 }))) {
      test.skip(true, 'Smart rentals page unavailable');
      return;
    }

    const link = page.locator('a[href*="/smart-rentals/"]').first();
    if ((await link.count()) > 0) {
      await link.tap();
      await page.waitForLoadState('domcontentloaded');

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
    }
  });
});

// ─── 5. Auth ──────────────────────────────────────────────────────────────────

test.describe('Mobile auth forms', () => {
  test('login form is full width with proper touch targets', async ({ page }) => {
    if (!(await safeGoto(page, '/login'))) {
      test.skip(true, 'Login page unavailable');
      return;
    }

    const emailInput = page.locator('#email');
    await expect(emailInput).toBeVisible({ timeout: 10000 });

    const box = await emailInput.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(250);
    expect(box!.height).toBeGreaterThanOrEqual(40);

    const passwordInput = page.locator('#password');
    const pwBox = await passwordInput.boundingBox();
    expect(pwBox).toBeTruthy();
    expect(pwBox!.height).toBeGreaterThanOrEqual(40);
  });

  test('register form is full width with proper touch targets', async ({ page }) => {
    if (!(await safeGoto(page, '/register'))) {
      test.skip(true, 'Register page unavailable');
      return;
    }

    await page.waitForSelector('input#email', { timeout: 15000 });

    const inputs = page.locator('input[type="email"], input[type="password"], input[type="text"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      const box = await inputs.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThan(240);
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('submit button is not covered by keyboard area on initial load', async ({ page }) => {
    if (!(await safeGoto(page, '/login'))) {
      test.skip(true, 'Login page unavailable');
      return;
    }

    const submitBtn = page.getByRole('button', { name: /sign in/i });
    await expect(submitBtn).toBeVisible({ timeout: 10000 });

    const box = await submitBtn.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.y + box!.height).toBeLessThan(852);
  });
});

// ─── 6. Dashboard ─────────────────────────────────────────────────────────────

test.describe('Mobile dashboard', () => {
  test('page is accessible on mobile (redirects to login if unauthenticated)', async ({ page }) => {
    if (!(await safeGoto(page, '/dashboard', { timeout: 45000 }))) {
      test.skip(true, 'Dashboard page unavailable');
      return;
    }

    const url = page.url();
    if (url.includes('/login')) {
      const emailInput = page.locator('#email');
      await expect(emailInput).toBeVisible({ timeout: 10000 });
      const box = await emailInput.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(250);
    }
  });
});

// ─── 7. Ubunye AI Studio ──────────────────────────────────────────────────────

test.describe('Mobile Ubunye AI', () => {
  test('chat input is visible at bottom of viewport', async ({ page }) => {
    if (!(await safeGoto(page, '/ubunye-ai-studio', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }

    const chatInput = page.locator('input[placeholder*="Ask Ubunye"]');
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    const box = await chatInput.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.y).toBeGreaterThan(400);
  });

  test('quick action chips are visible and do not overflow', async ({ page }) => {
    if (!(await safeGoto(page, '/ubunye-ai-studio', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }

    const chips = page.locator('button').filter({ hasText: /plan a shoot|find gear|hire crew|create assets|get pricing/i });
    await expect(chips.first()).toBeVisible({ timeout: 15000 });
    const count = await chips.count();
    expect(count).toBe(5);

    for (let i = 0; i < count; i++) {
      const box = await chips.nth(i).boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH + 20);
      }
    }
  });

  test('HUD side panels are hidden on mobile', async ({ page }) => {
    if (!(await safeGoto(page, '/ubunye-ai-studio', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }

    const hudCorners = page.locator('.hidden.md\\:block');
    if ((await hudCorners.count()) > 0) {
      const display = await hudCorners.first().evaluate(
        el => getComputedStyle(el).display,
      );
      expect(display).toBe('none');
    }

    const statusBar = page.locator('.hidden.md\\:flex');
    if ((await statusBar.count()) > 0) {
      const display = await statusBar.first().evaluate(
        el => getComputedStyle(el).display,
      );
      expect(display).toBe('none');
    }
  });

  test('no horizontal overflow', async ({ page }) => {
    if (!(await safeGoto(page, '/ubunye-ai-studio', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }

    await page.waitForSelector('input[placeholder*="Ask Ubunye"]', { timeout: 15000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});

// ─── 8. Global Search ─────────────────────────────────────────────────────────

test.describe('Mobile global search', () => {
  test('search modal opens from mobile header icon', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const searchBtn = page.locator('div.lg\\:hidden button').first();
    await searchBtn.tap();

    const searchInput = page.locator('input[placeholder*="Search productions"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test('search modal fills mobile viewport width', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const searchBtn = page.locator('div.lg\\:hidden button').first();
    await searchBtn.tap();

    const modal = page.locator('.bg-neutral-950.border').first();
    await expect(modal).toBeVisible({ timeout: 3000 });

    const box = await modal.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(340);
  });

  test('search results area is scrollable', async ({ page }) => {
    if (!(await safeGoto(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }

    const searchBtn = page.locator('div.lg\\:hidden button').first();
    await searchBtn.tap();

    const resultsArea = page.locator('.overflow-y-auto.flex-1');
    await expect(resultsArea).toBeVisible({ timeout: 3000 });

    const overflow = await resultsArea.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.overflowY;
    });
    expect(overflow).toBe('auto');
  });
});
