import { test, expect, type Page } from '@playwright/test';

/**
 * Spec 9.1, account creation and sign-in: one screen with "Continue with
 * Google" or "Continue with email", passwordless email (a link that also
 * carries a code), no confirm-password field, and a clear terms disclosure.
 *
 * Supabase is not reachable from the test server, so the auth API calls the
 * browser makes are intercepted with page.route(): only the request shape and
 * the UI's response to it are checked here, never a real sign-in.
 */

/** Any Supabase Auth endpoint, whatever project URL the build points at. */
const AUTH_API = (path: string) => new RegExp(`/auth/v1/${path}(\\?|$)`);

async function openLogin(page: Page, query = '') {
  await page.goto(`/login${query}`);
  await expect(page.locator('#email')).toBeVisible({ timeout: 15_000 });
}

test.describe('Sign-in screen (spec 9.1)', () => {
  test('shows Continue with Google, Continue with email and the terms disclosure', async ({ page }) => {
    await openLogin(page);

    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with email/i })).toBeVisible();

    const notice = page.getByTestId('terms-notice');
    await expect(notice).toContainText(/by continuing you agree to our/i);
    const terms = notice.getByRole('link', { name: /terms/i });
    const privacy = notice.getByRole('link', { name: /privacy/i });
    await expect(terms).toBeVisible();
    await expect(privacy).toBeVisible();
    expect(await terms.getAttribute('href')).toMatch(/^\//);
    expect(await privacy.getAttribute('href')).toMatch(/^\//);

    // The disclosure is not a hidden pre-ticked box: nothing to tick here.
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test('is passwordless by default and never asks to confirm a password', async ({ page }) => {
    await openLogin(page);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.getByRole('button', { name: /use a password instead/i }).click();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
    await expect(page.locator('#confirmPassword')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible();

    await page.getByRole('button', { name: /email me a sign-in code instead/i }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('/register redirects to /login, keeping the destination', async ({ page }) => {
    await page.goto('/register?redirect=%2Frentals%2Fx&reason=book');
    await expect(page).toHaveURL(/\/login\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('redirect')).toBe('/rentals/x');
    expect(url.searchParams.get('reason')).toBe('book');
    expect(url.searchParams.get('mode')).toBe('signup');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
    await expect(page.locator('#confirmPassword')).toHaveCount(0);

    await page.goto('/register?next=%2Fstudio%2Fbirthday');
    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/studio/birthday');
  });

  test('an empty or malformed email is announced as an error on the field', async ({ page }) => {
    await openLogin(page);
    await page.locator('#email').fill('not-an-email');
    await page.getByRole('button', { name: /continue with email/i }).click();

    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toContainText(/valid email/i);
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await page.locator('#email').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveAttribute('role', 'alert');
  });

  test('Continue with email sends one email, then offers code entry or the link', async ({ page }) => {
    let otpBody: Record<string, unknown> | null = null;
    await page.route(AUTH_API('otp'), async (route) => {
      otpBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route(AUTH_API('verify'), (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
      }),
    );

    await openLogin(page, '?redirect=%2Frentals%2Fx');
    await page.locator('#email').fill('someone@example.com');
    await page.getByRole('button', { name: /continue with email/i }).click();

    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
    await expect(page.getByText(/tap the link in it, or enter the code/i)).toBeVisible();
    const code = page.locator('#code');
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');

    // The email link returns through the callback, carrying the destination.
    expect(otpBody).not.toBeNull();
    expect(JSON.stringify(otpBody)).toContain('someone@example.com');

    // A wrong or expired code: a plain error tied to the field.
    await code.fill('123456');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(/didn't work/i);
    await expect(code).toHaveAttribute('aria-invalid', 'true');

    // Back to change the address, which is kept.
    await page.getByRole('button', { name: /use a different email/i }).click();
    await expect(page.locator('#email')).toHaveValue('someone@example.com');
  });

  test('the email-link return address keeps a safe destination and drops an unsafe one', async ({ page }) => {
    const redirects: string[] = [];
    await page.route(AUTH_API('otp'), async (route) => {
      redirects.push(new URL(route.request().url()).searchParams.get('redirect_to') ?? '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await openLogin(page, '?next=%2Frentals%2Fx');
    await page.locator('#email').fill('someone@example.com');
    await page.getByRole('button', { name: /continue with email/i }).click();
    await expect(page.locator('#code')).toBeVisible();

    await openLogin(page, '?next=https%3A%2F%2Fevil.example');
    await page.locator('#email').fill('someone@example.com');
    await page.getByRole('button', { name: /continue with email/i }).click();
    await expect(page.locator('#code')).toBeVisible();

    expect(redirects).toHaveLength(2);
    expect(redirects[0]).toMatch(/\/auth\/callback\?next=%2Frentals%2Fx$/);
    expect(redirects[1]).toMatch(/\/auth\/callback$/);
    expect(redirects.join(' ')).not.toContain('evil');
  });

  test('a real sign-in with the emailed code', async () => {
    test.skip(true, 'Needs a live Supabase project and a real inbox to read the code from.');
  });

  test('every control on the screen is at least 44px tall', async ({ page }) => {
    await openLogin(page);
    await page.getByRole('button', { name: /use a password instead/i }).click();
    const controls = page.locator('main button:visible, main input:visible, [data-testid="terms-notice"] a');
    const count = await controls.count();
    expect(count).toBeGreaterThan(4);
    for (let i = 0; i < count; i++) {
      const box = await controls.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height, `control ${i} is ${box.height}px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  test('inputs are at least 16px on a phone, so iOS does not zoom', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openLogin(page);
    const size = await page.locator('#email').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test('a signed-out visit to a dashboard page returns there after sign-in', async ({ page }) => {
    await page.goto('/dashboard/bookings?tab=past');
    await page.waitForURL(/\/login\?/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard/bookings?tab=past');
    await expect(page.locator('#email')).toBeVisible();
  });
});
