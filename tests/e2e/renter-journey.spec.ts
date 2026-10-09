import { test, expect, type Page } from '@playwright/test';

/**
 * Renter journey, Phase 3 (spec §9): choose equipment, choose dates, review
 * and reserve, pay. What can run without a database runs always (the API
 * contracts and auth gates). The gear-page checks need at least one listing;
 * without one (no database in this run) they skip and say why.
 */

const NO_DATA = 'No gear listing is reachable (this run has no database data), so the gear page cannot be opened.';

async function safeGoto(page: Page, path: string, timeout = 30_000): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout });
  } catch {
    // The page may still have loaded partially; the assertions decide.
  }
}

/** The first gear page linked from the catalogue (/rentals/<category>/<slug>), or null. */
async function findGearPage(page: Page): Promise<string | null> {
  await safeGoto(page, '/rentals');
  const hrefs = await page.locator('a[href^="/rentals/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  const gear = hrefs.find((h) => /^\/rentals\/[^/?#]+\/[^/?#]+/.test(h));
  if (gear) return gear.split('?')[0];
  const category = hrefs.find((h) => /^\/rentals\/[^/?#]+$/.test(h));
  if (!category) return null;
  await safeGoto(page, category);
  const inner = await page.locator('a[href^="/rentals/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  const found = inner.find((h) => /^\/rentals\/[^/?#]+\/[^/?#]+/.test(h));
  return found ? found.split('?')[0] : null;
}

/** A date at least a week out, as YYYY-MM-DD (clears the notice period). */
function ymdInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('Renter journey: contracts that need no database', () => {
  test('eligibility endpoint asks a signed-out visitor to sign in, with a code', async ({ page }) => {
    const res = await page.request.get('/api/rentals/eligibility?rental_id=11111111-2222-4333-8444-555555555555');
    expect(res.status()).toBe(401);
    expect((await res.json()).code).toBe('SIGN_IN_REQUIRED');
  });

  test('releasing a cancelled payment needs a signed-in renter', async ({ page }) => {
    const base = test.info().project.use.baseURL ?? 'http://localhost:3000';
    const res = await page.request.post('/api/cart/cancel', {
      data: { checkout_group_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      headers: { Origin: base },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('the cart stays behind sign-in, also on the way back from payment', async ({ page }) => {
    await safeGoto(page, '/dashboard/cart?payment=cancelled&order=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    await page.waitForLoadState('domcontentloaded');
    const url = page.url();
    const body = (await page.textContent('body')) ?? '';
    expect(url.includes('/login') || /sign in|log in/i.test(body)).toBe(true);
  });
});

test.describe('Renter journey: gear page', () => {
  test('the booking widget and its date picker are keyboard and screen-reader operable', async ({ page }) => {
    const gear = await findGearPage(page);
    test.skip(!gear, NO_DATA);
    await safeGoto(page, gear!);
    const widget = page.getByTestId('booking-widget');
    test.skip((await widget.count()) === 0, 'This listing is not available for hire, so it has no booking widget.');

    const trigger = widget.getByRole('button', { name: /rental dates/i });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await trigger.getAttribute('aria-controls')).toBe(await dialog.getAttribute('id'));

    // Focus lands on a day named with its full date, and arrows move it.
    const focused = page.locator('[role="grid"] button:focus');
    await expect(focused).toHaveAttribute('aria-label', /\d{4}/);
    const first = await focused.getAttribute('data-date');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[role="grid"] button:focus')).not.toHaveAttribute('data-date', first ?? '');

    // Day targets are at least 44px tall.
    const box = await page.locator('[role="grid"] button').first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('signed out: what renting needs is shown before anything is asked', async ({ page }) => {
    const gear = await findGearPage(page);
    test.skip(!gear, NO_DATA);
    await safeGoto(page, gear!);
    const widget = page.getByTestId('booking-widget');
    test.skip((await widget.count()) === 0, 'This listing is not available for hire, so it has no booking widget.');

    const summary = widget.getByRole('region', { name: 'What you need to rent' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/ID check/i);
    await expect(summary).toContainText(/phone/i);
    await expect(summary).toContainText(/collected in person/i);
  });

  test('dates come first: no price or booking before valid dates, and a same-day range explains itself', async ({ page }) => {
    const gear = await findGearPage(page);
    test.skip(!gear, NO_DATA);
    await safeGoto(page, gear!);
    const widget = page.getByTestId('booking-widget');
    test.skip((await widget.count()) === 0, 'This listing is not available for hire, so it has no booking widget.');

    await expect(widget.getByText('Choose your dates above to see the price.')).toBeVisible();
    await expect(widget.getByText(/total with deposit/i)).toHaveCount(0);

    const day = ymdInDays(10);
    await safeGoto(page, `${gear}?start=${day}&end=${day}`);
    await expect(page.getByTestId('booking-widget').getByText(/returned the next day/i).first()).toBeVisible();
  });
});
