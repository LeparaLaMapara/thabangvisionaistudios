import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Automated accessibility checks (spec 9.5: keyboard and screen-reader
// support, accessible colour contrast). Runs axe-core against the main public
// pages in two projects from playwright.config.ts: "chromium" (desktop) and
// "a11y-mobile" (iPhone 14 viewport).
//
// The bar is zero serious or critical WCAG 2.1 A/AA violations. Moderate and
// minor findings are printed for follow-up but do not fail the run.
//
// axe catches roughly a third of real-world issues. It is a floor, not a
// substitute for keyboard and screen-reader passes on new flows.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['serious', 'critical']);

/** Pages checked, desktop and mobile. `/book` redirects to sign-in when logged out. */
const PAGES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'rentals index', path: '/rentals' },
  { name: 'rental category', path: '/rentals/cameras-optics' },
  { name: 'login', path: '/login' },
  { name: 'book', path: '/book' },
  { name: 'plan', path: '/plan' },
];

async function settle(page: Page, path: string): Promise<boolean> {
  try {
    const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (!res || res.status() >= 500) return false;
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => undefined);
    // Let entrance animations (framer-motion fades) finish so axe measures
    // final colours, not a half-faded frame.
    await page.waitForTimeout(1500);
    return true;
  } catch {
    return false;
  }
}

/**
 * Excluded from scanning, each with its reason:
 * - The footer's large "THABANGVISION" wordmark is the brand logotype set in
 *   faint type on purpose. WCAG 1.4.3 exempts text that is part of a logo or
 *   brand name from contrast requirements.
 */
const EXCLUDE = ['footer .font-black.italic'];

function axe(page: Page): AxeBuilder {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of EXCLUDE) builder = builder.exclude(selector);
  return builder;
}

async function scan(page: Page) {
  const results = await axe(page).analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
  const advisory = results.violations.filter((v) => !BLOCKING.has(v.impact ?? ''));
  const describe = (vs: typeof results.violations) =>
    vs
      .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join('\n    ')}`)
      .join('\n');
  return { blocking, advisory, describe };
}

test.describe('Accessibility (axe, WCAG 2.1 AA)', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  for (const { name, path } of PAGES) {
    test(`${name} (${path}) has no serious or critical violations`, async ({ page }, testInfo) => {
      if (!(await settle(page, path))) {
        test.skip(true, `${path} unavailable`);
        return;
      }
      const { blocking, advisory, describe } = await scan(page);
      if (advisory.length > 0) {
        testInfo.annotations.push({ type: 'axe-advisory', description: describe(advisory) });
      }
      expect(blocking, `axe violations on ${path}:\n${describe(blocking)}`).toEqual([]);
    });
  }

  test('rental detail page has no serious or critical violations', async ({ page }) => {
    // Needs a published rental, so it follows the first card on a category
    // page; skipped when the catalogue is empty or the database is unreachable.
    if (!(await settle(page, '/rentals/cameras-optics'))) {
      test.skip(true, 'Category page unavailable');
      return;
    }
    const detail = page.locator('a[href^="/rentals/cameras-optics/"]').first();
    if ((await detail.count()) === 0) {
      test.skip(true, 'No published rentals to open');
      return;
    }
    const href = await detail.getAttribute('href');
    if (!href || !(await settle(page, href))) {
      test.skip(true, 'Rental detail unavailable');
      return;
    }
    const { blocking, describe } = await scan(page);
    expect(blocking, `axe violations on ${href}:\n${describe(blocking)}`).toEqual([]);
  });

  test('mobile menu dialog has no serious or critical violations', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= 1024, 'Mobile menu only exists below the lg breakpoint');
    if (!(await settle(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }
    await page.getByRole('button', { name: 'Open menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Menu' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    const results = await axe(page).include('[role="dialog"]').analyze();
    const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

// ─── Keyboard behaviour axe cannot see ─────────────────────────────────────────

test.describe('Keyboard and focus', () => {
  test('mobile menu traps focus, closes on Escape and returns focus to the button', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= 1024, 'Mobile menu only exists below the lg breakpoint');
    if (!(await settle(page, '/'))) {
      test.skip(true, 'Home page unavailable');
      return;
    }
    const opener = page.getByRole('button', { name: 'Open menu' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Menu' });
    await expect(dialog).toBeVisible();

    // Focus is inside the dialog, and many Tabs later it still is.
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });

  test('skip link is reachable first and sits above the header', async ({ page }) => {
    if (!(await settle(page, '/rentals'))) {
      test.skip(true, 'Rentals page unavailable');
      return;
    }
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    // The element at the link's centre is the link itself, not the header.
    const onTop = await skip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(onTop).toBe(true);
  });

  test('Ubunye studio input and send button are labelled', async ({ page }) => {
    if (!(await settle(page, '/plan'))) {
      test.skip(true, 'Plan unavailable');
      return;
    }
    await expect(page.getByRole('textbox', { name: 'Message Ubunye' })).toBeVisible({ timeout: 15_000 });
    const send = page.getByRole('button', { name: 'Send message' });
    await expect(send).toBeVisible();
    const box = await send.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
