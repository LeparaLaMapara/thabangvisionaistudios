import { test, expect, type Page } from '@playwright/test';

/**
 * The sign-in screen. Owner decision 2026-10-14: the ONLY ways in are
 * "Continue with Google" and email + password. Create account is email +
 * password with a confirmation link; Forgot password sends a reset link.
 * There is no magic link and no emailed sign-in code.
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

test.describe('Sign-in screen', () => {
  test('shows Google, email + password, Forgot password and the terms disclosure', async ({ page }) => {
    await openLogin(page);

    await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    await expect(page.getByText(/signed up with an email link before\? use forgot password to set a password/i)).toBeVisible();

    // No passwordless path at all.
    await expect(page.getByRole('button', { name: /continue with email/i })).toHaveCount(0);
    await expect(page.getByText(/sign-in code|no password needed/i)).toHaveCount(0);
    await expect(page.locator('#code')).toHaveCount(0);

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

  test('Create account shows the password rule and never asks to confirm the password', async ({ page }) => {
    await openLogin(page);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
    await expect(page.locator('#confirmPassword')).toHaveCount(0);
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();

    await page.getByRole('button', { name: /already have an account\? sign in/i }).click();
    await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible();
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
  });

  test('Show reveals the password', async ({ page }) => {
    await openLogin(page);
    await page.locator('#password').fill('secret-123');
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  });

  test('/register opens Create account, keeping the destination', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toContainText(/valid email/i);
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await page.locator('#email').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveAttribute('role', 'alert');
  });

  test('a short password is refused before anything is sent', async ({ page }) => {
    let called = false;
    await page.route(AUTH_API('signup'), async (route) => {
      called = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await openLogin(page, '?mode=signup');
    await page.locator('#email').fill('someone@example.com');
    await page.locator('#password').fill('short');
    await page.getByRole('button', { name: /create account/i }).first().click();
    await expect(page.locator('main').getByRole('alert')).toContainText(/at least 8 characters/i);
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
    expect(called).toBe(false);
  });

  test('Create account calls signUp with the password and the callback, then asks to check email', async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    let redirectTo = '';
    await page.route(AUTH_API('signup'), async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      redirectTo = new URL(route.request().url()).searchParams.get('redirect_to') ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', email: 'someone@example.com', identities: [{ id: 'x' }] }),
      });
    });

    await openLogin(page, '?mode=signup&next=%2Frentals%2Fx');
    await page.locator('#email').fill('someone@example.com');
    await page.locator('#password').fill('long-enough-1');
    await page.getByRole('button', { name: /create account/i }).first().click();

    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
    await expect(page.getByText(/tap the link in it to confirm your address/i)).toBeVisible();
    expect(body).not.toBeNull();
    expect(JSON.stringify(body)).toContain('someone@example.com');
    expect(JSON.stringify(body)).toContain('long-enough-1');
    expect(redirectTo).toMatch(/\/auth\/callback\?next=%2Frentals%2Fx$/);
  });

  test('a wrong password says so plainly and points to Forgot password', async ({ page }) => {
    await page.route(AUTH_API('token'), (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
      }),
    );
    await openLogin(page);
    await page.locator('#email').fill('someone@example.com');
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(/don't match/i);
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
  });

  test('Forgot password sends a reset link to /reset-password', async ({ page }) => {
    let redirectTo = '';
    await page.route(AUTH_API('recover'), async (route) => {
      redirectTo = new URL(route.request().url()).searchParams.get('redirect_to') ?? '';
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await openLogin(page);
    await page.locator('#email').fill('someone@example.com');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.locator('#resetEmail')).toHaveValue('someone@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText(/sent a link to set a new password/i)).toBeVisible();
    expect(redirectTo).toMatch(/\/reset-password$/);
  });

  test('every control on the screen is at least 44px tall', async ({ page }) => {
    await openLogin(page);
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
    for (const id of ['#email', '#password']) {
      const size = await page.locator(id).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
    }
  });

  test('a signed-out visit to a dashboard page returns there after sign-in', async ({ page }) => {
    await page.goto('/dashboard/bookings?tab=past');
    await page.waitForURL(/\/login\?/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard/bookings?tab=past');
    await expect(page.locator('#email')).toBeVisible();
  });
});
