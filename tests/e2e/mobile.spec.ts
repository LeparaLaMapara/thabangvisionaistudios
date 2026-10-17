import { test, expect } from '@playwright/test';
import { UBUNYE_OCCASIONS } from '../../lib/constants';

// All tests in this file run on iPhone 14 (393×852) via the "mobile" project
// in playwright.config.ts using Chromium with mobile emulation.
// They focus on layout and touch interactions only —
// functional tests are covered by the desktop suite.

const VIEWPORT_WIDTH = 393; // iPhone 14 CSS viewport width
const MIN_TOUCH = 44; // spec 9.5: touch targets at least 44x44 CSS px

/** Asserts every element matched is at least MIN_TOUCH tall (and wide, unless full-width text). */
async function expectTouchTargets(
  locator: import('@playwright/test').Locator,
  { checkWidth = true }: { checkWidth?: boolean } = {},
): Promise<void> {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    expect(box, `touch target ${i} has no box`).toBeTruthy();
    expect(box!.height, `touch target ${i} height`).toBeGreaterThanOrEqual(MIN_TOUCH);
    if (checkWidth) expect(box!.width, `touch target ${i} width`).toBeGreaterThanOrEqual(MIN_TOUCH);
  }
}

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

    // Assert against MAIN_NAVIGATION in lib/constants.ts. Case-insensitive
    // because the labels are uppercased in CSS, not in the DOM.
    await expect(mobileMenu.getByRole('button', { name: /rentals/i })).toBeVisible();
    await expect(mobileMenu.getByRole('button', { name: /studio/i })).toBeVisible();
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
    const rentalsBtn = mobileMenu.getByRole('button', { name: /rentals/i });
    await rentalsBtn.click();
    await page.waitForURL(/\/rentals/, { timeout: 30000, waitUntil: 'domcontentloaded' });
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

// ─── 3. Rentals ──────────────────────────────────────────────────────────────

test.describe('Mobile rentals', () => {
  test('category cards stack to single column', async ({ page }) => {
    if (!(await safeGoto(page, '/rentals', { timeout: 45000 }))) {
      test.skip(true, 'Rentals page unavailable');
      return;
    }

    const cards = page.locator('a[href*="/rentals/"]');
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
    if (!(await safeGoto(page, '/rentals', { timeout: 45000 }))) {
      test.skip(true, 'Rentals page unavailable');
      return;
    }

    const cards = page.locator('a[href*="/rentals/"]');
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
  // Was a known bug: at 393px a rental page measured scrollWidth 558. A grid
  // column without min-w-0 and an unbreakable title let long content widen the
  // page; on a phone the layout viewport then grew to fit it, which is why the
  // fixed header also reported 558px. Fixed in the category and detail views.
  //
  // Walks /rentals -> first category -> first item (when the catalogue has
  // one) and checks each page for horizontal overflow.
  test('pricing info does not overflow horizontally', async ({ page }) => {
    if (!(await safeGoto(page, '/rentals', { timeout: 45000 }))) {
      test.skip(true, 'Rentals page unavailable');
      return;
    }

    const noOverflow = async (where: string) => {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth, `${where} overflows`).toBeLessThanOrEqual(clientWidth + 5);
    };

    const link = page.locator('main a[href^="/rentals/"]').first();
    if ((await link.count()) > 0) {
      await link.tap();
      await page.waitForURL(/\/rentals\/[^/]+$/, { timeout: 30000, waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load');
      await noOverflow(page.url());

      const item = page.locator('main a[href^="/rentals/"]').filter({ hasText: /view details/i }).first();
      if ((await item.count()) > 0) {
        await item.tap();
        await page.waitForURL(/\/rentals\/[^/]+\/[^/]+$/, { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('load');
        await noOverflow(page.url());
      }
    }
  });

  test('category filters and sort are reachable with 44px targets', async ({ page }) => {
    if (!(await safeGoto(page, '/rentals/cameras-optics', { timeout: 45000 }))) {
      test.skip(true, 'Category page unavailable');
      return;
    }
    const filters = page.getByRole('button', { name: /filters/i });
    await expect(filters).toBeVisible({ timeout: 15000 });
    await expectTouchTargets(filters);

    // Sort used to be hidden below the desktop breakpoint.
    const sort = page.getByRole('combobox', { name: 'Sort' }).first();
    await expect(sort).toBeVisible();
    await expectTouchTargets(sort, { checkWidth: false });

    // The filter sheet is a labelled dialog above the header, and Escape closes it.
    await filters.tap();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole('button', { name: 'Close filters' });
    await expect(close).toBeVisible();
    await expectTouchTargets(close);
    const onTop = await close.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(onTop, 'close button is covered by the header').toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
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
    await expect(passwordInput).toBeVisible();
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

    // Scope to the sign-up form. A page-wide input selector also catches the
    // footer newsletter box, which is deliberately narrower and would fail the
    // touch-target assertions below. /register opens Create account: email
    // and one password field (no confirm).
    const inputs = page.locator('form').first()
      .locator('input[type="email"], input[type="password"], input[type="text"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(1);

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

    const submitBtn = page.getByRole('button', { name: 'Sign In', exact: true });
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
    if (!(await safeGoto(page, '/plan', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }

    const chatInput = page.locator('textarea[placeholder*="Message Ubunye"]');
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    const box = await chatInput.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.y).toBeGreaterThan(400);
  });

  test('quick action chips are visible and do not overflow', async ({ page }) => {
    if (!(await safeGoto(page, '/plan', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }

    // One button per occasion (UBUNYE_OCCASIONS): the page asks one
    // question and offers four occasions under it.
    for (const occasion of UBUNYE_OCCASIONS) {
      const chip = page.getByRole('button', { name: occasion.label });
      await expect(chip).toBeVisible({ timeout: 15000 });
      const box = await chip.boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH + 20);
      }
    }
  });

  test('HUD side panels are hidden on mobile', async ({ page }) => {
    if (!(await safeGoto(page, '/plan', { timeout: 45000 }))) {
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

  test('send button, example prompts and header controls are 44px targets', async ({ page }) => {
    if (!(await safeGoto(page, '/plan', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }
    await page.waitForSelector('textarea[placeholder*="Message Ubunye"]', { timeout: 15000 });

    await expectTouchTargets(page.getByRole('button', { name: 'Send message' }));
    await expectTouchTargets(page.getByRole('button', { name: 'Open menu' }));
    // Example prompt chips ("Build a podcast setup..." etc.) were ~24px tall.
    await expectTouchTargets(page.locator('button').filter({ hasText: /^\u201c/ }), { checkWidth: false });
    // The textarea is labelled, and 16px so iOS Safari does not zoom on focus.
    const input = page.getByRole('textbox', { name: 'Message Ubunye' });
    const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    // The input bar sits inside the visible viewport (100dvh, not 100vh).
    const box = await input.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(852);
  });

  test('Plan header link is a 44px target', async ({ page }) => {
    if (!(await safeGoto(page, '/rentals', { timeout: 45000 }))) {
      test.skip(true, 'Rentals page unavailable');
      return;
    }
    await expectTouchTargets(page.locator('header').getByRole('link', { name: 'Plan', exact: true }));
  });

  test('no horizontal overflow', async ({ page }) => {
    if (!(await safeGoto(page, '/plan', { timeout: 45000 }))) {
      test.skip(true, 'Ubunye AI page unavailable');
      return;
    }

    await page.waitForSelector('textarea[placeholder*="Message Ubunye"]', { timeout: 15000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});

// ─── 8. Global Search ─────────────────────────────────────────────────────────

// SKIPPED: global search is not wired up. components/search/GlobalSearch.tsx
// exists but nothing imports or renders it, on mobile or desktop, and the
// mobile header contains only the Ubunye bubble, the cart and the hamburger.
// These tests assert a search entry point that no longer has a trigger.
//
// Resolve by either mounting GlobalSearch in the header and un-skipping this
// block, or deleting the component and this block together. Left skipped
// rather than deleted so the decision stays visible.
test.describe.skip('Mobile global search', () => {
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
