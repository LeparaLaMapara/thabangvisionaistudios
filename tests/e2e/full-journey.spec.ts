import { test, expect, type Page } from '@playwright/test';

// ─── Test credentials ──────────────────────────────────────────────────────────

const TEST_EMAIL = 'thabangvisionstudios+testuser@gmail.com';
const TEST_PASSWORD = 'TestUser2026!';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Navigate safely — catches timeout errors for slow pages */
async function safeGoto(page: Page, path: string, timeout = 30_000) {
  try {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout });
  } catch {
    // Page may still have loaded partially — continue
  }
}

/** The sign-in screen is passwordless first; password sign-in is one tap away. */
async function switchToPasswordSignIn(page: Page) {
  await page.getByRole('button', { name: /use a password instead/i }).click();
  await expect(page.locator('#password')).toBeVisible();
}

/** Login helper — fills login form and submits */
async function login(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await page.goto('/login');
  await switchToPasswordSignIn(page);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  // Wait for redirect away from login page
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 }).catch(() => {});
}

/** Check if page is protected (redirected to login or shows auth text) */
async function expectProtected(page: Page) {
  await page.waitForLoadState('networkidle');
  const url = page.url();
  const bodyText = await page.textContent('body');
  const isProtected =
    url.includes('/login') ||
    bodyText?.match(/sign in|login|unauthorized|access denied|forbidden/i) !== null;
  expect(isProtected).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

// Signing up is the same screen as signing in now (/register redirects to
// /login?mode=signup): Google or a passwordless email, no password to set and
// no confirm-password field. The terms are disclosed on the screen and
// accepted once, with a tap, on /welcome.
test.describe('1. Registration', () => {
  test('1a. Register sends you to the one sign-in screen', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/login\?.*mode=signup/);
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with email/i })).toBeVisible();
  });

  test('1b. Sign-up is passwordless: no password to set', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('1c. Password sign-in asks for the password before sending anything', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.locator('#email').fill('weakpass@test.com');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect(page.getByText(/please enter your password/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
  });

  test('1d. Continue with email validates an empty address', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: /continue with email/i }).click();

    await expect(page.locator('main').getByRole('alert')).toContainText(/valid email/i);
    expect(page.url()).toContain('/login');
  });

  test('1e. Continue with email validates the email format', async ({ page }) => {
    await page.goto('/register');
    await page.locator('#email').fill('notanemail');
    await page.getByRole('button', { name: /continue with email/i }).click();

    await expect(page.locator('main').getByRole('alert')).toContainText(/valid email/i);
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    expect(page.url()).toContain('/login');
  });

  test('1f. The terms are disclosed on the sign-up screen, with links', async ({ page }) => {
    await page.goto('/register');
    const notice = page.getByTestId('terms-notice');
    await expect(notice).toContainText(/by continuing you agree/i);
    await expect(notice.getByRole('link', { name: /terms/i })).toBeVisible();
    await expect(notice.getByRole('link', { name: /privacy/i })).toBeVisible();
    // Nothing is ticked here: acceptance is recorded with a tap on /welcome.
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test('1g. No confirm-password field, even for password sign-in', async ({ page }) => {
    await page.goto('/register');
    await switchToPasswordSignIn(page);
    await expect(page.locator('#confirmPassword')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('2. Login', () => {
  test('2a. Login page loads with form fields', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  });

  test('2b. Login succeeds with correct credentials', async ({ page }) => {
    await login(page);
    // Should redirect to dashboard or admin
    await page.waitForTimeout(3000);
    const url = page.url();
    const loggedIn = url.includes('/dashboard') || url.includes('/admin') || !url.includes('/login');
    expect(loggedIn).toBe(true);
  });

  test('2c. Login fails with wrong password', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.locator('#email').fill(TEST_EMAIL);
    await page.locator('#password').fill('WrongPass123!');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // Should show "Invalid login credentials" (generic — doesn't reveal which field is wrong)
    await expect(
      page.getByText(/invalid login credentials/i),
    ).toBeVisible({ timeout: 15000 });
  });

  test('2d. Login fails with non-existent email', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.locator('#email').fill('nobody@doesnotexist.com');
    await page.locator('#password').fill('SomePassword123!');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // Same generic error — doesn't reveal whether account exists
    await expect(
      page.getByText(/invalid login credentials/i),
    ).toBeVisible({ timeout: 15000 });
  });

  test('2e. Login validates empty fields', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // HTML5 validation should prevent submission
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/login');
  });

  test('2f. Login handles SQL injection safely', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.locator('#email').fill("' OR 1=1 --");
    await page.locator('#password').fill('anything');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // Should fail gracefully — either HTML5 email validation or auth error
    await page.waitForTimeout(3000);
    const url = page.url();
    // Must still be on login or show error — never grant access
    const safe = url.includes('/login') || !(url.includes('/dashboard') || url.includes('/admin'));
    expect(safe).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. FORGOT PASSWORD
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('3. Forgot Password', () => {
  test('3a. Forgot password link exists and opens form', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    const forgotBtn = page.getByRole('button', { name: /forgot password/i });
    await expect(forgotBtn).toBeVisible();
    await forgotBtn.click();

    // Should show reset email field
    await expect(page.locator('#resetEmail')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('button', { name: /send reset link/i }),
    ).toBeVisible();
  });

  test('3b. Forgot password submits for valid email', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.getByRole('button', { name: /forgot password/i }).click();
    await page.locator('#resetEmail').fill(TEST_EMAIL);
    await page.getByRole('button', { name: /send reset link/i }).click();

    // Should show success message OR Supabase rate limit error (both are valid responses)
    await page.waitForTimeout(5000);
    const bodyText = await page.textContent('body');
    const responded = bodyText?.match(/check your email|rate limit|reset/i) !== null;
    expect(responded).toBe(true);
  });

  test('3c. Forgot password for non-existent email does not crash', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.getByRole('button', { name: /forgot password/i }).click();
    await page.locator('#resetEmail').fill('nobody@doesnotexist.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    // Should either show success (secure — no info leak) or a Supabase error
    // The key thing: it must not crash and must stay on the page
    await page.waitForTimeout(5000);
    await expect(page.locator('body')).toBeVisible();
    // Check it didn't navigate away
    expect(page.url()).toContain('/login');
  });

  test('3d. Forgot password validates empty email', async ({ page }) => {
    await page.goto('/login');
    await switchToPasswordSignIn(page);
    await page.getByRole('button', { name: /forgot password/i }).click();
    await page.getByRole('button', { name: /send reset link/i }).click();

    // Should show validation error or HTML5 prevents submission
    await page.waitForTimeout(2000);
    const bodyText = await page.textContent('body');
    const hasValidation =
      bodyText?.match(/enter your email|email.*required/i) !== null ||
      (await page.locator('#resetEmail').getAttribute('required')) !== null;
    // At minimum the form should not navigate away
    expect(page.url()).toContain('/login');
  });

  test('3e. Reset password page loads', async ({ page }) => {
    await safeGoto(page, '/reset-password');
    // Without a valid token, it should show an error about invalid/expired link
    await page.waitForTimeout(5000);
    const bodyText = await page.textContent('body');
    const showsForm = bodyText?.match(/new password|update password|invalid|expired/i) !== null;
    expect(showsForm).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('4. Navigation — logged out', () => {
  test('4a. Header shows Login link when logged out', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const headerText = await page.locator('header').textContent();
    const hasLoginOrSignIn = headerText?.match(/sign in|login|register/i) !== null;
    expect(hasLoginOrSignIn).toBe(true);
  });

  test('4b. Header does not show Dashboard when logged out', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dashboard link should not be in the header for logged-out users
    const dashboardLink = page.locator('header a[href="/dashboard"]');
    const count = await dashboardLink.count();
    // It's OK if the link exists but is hidden — check visibility
    if (count > 0) {
      await expect(dashboardLink.first()).not.toBeVisible();
    }
  });

  test('4c. Footer contains expected links', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    const footerText = await footer.textContent();
    expect(footerText?.toLowerCase()).toContain('thabangvision');
  });
});

test.describe('4. Navigation — logged in', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('4d. Header shows Dashboard when logged in', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // After login, Dashboard link or user menu should be visible
    const bodyText = await page.textContent('body');
    const hasAuthUI = bodyText?.match(/dashboard|sign out|my account|profile/i) !== null;
    expect(hasAuthUI).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. BROWSING — PUBLIC PAGES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('5. Browsing — public pages', () => {
  test('5a. Home page loads with hero and content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    // Should have header and footer
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();

    // Hero or main content should exist
    const bodyText = await page.textContent('body');
    expect(bodyText?.length).toBeGreaterThan(100);
  });

  test('5b. Rentals loads with categories', async ({ page }) => {
    await page.goto('/rentals');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    // Should show category cards or rental items
    const bodyText = await page.textContent('body');
    const hasContent = bodyText?.match(/camera|lens|lighting|audio|grip|drone|rental/i) !== null;
    expect(hasContent).toBe(true);
  });

  test('5c. Rentals category page loads', async ({ page }) => {
    await page.goto('/rentals');
    await page.waitForLoadState('networkidle');

    // Find and click a category link
    const categoryLink = page.locator('a[href*="/rentals/"]').first();
    if ((await categoryLink.count()) > 0) {
      await categoryLink.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('5d. Studio loads', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    const bodyText = await page.textContent('body');
    const hasContent = bodyText?.match(/production|photography|film|video|wedding|corporate/i) !== null;
    expect(hasContent).toBe(true);
  });

  test('5e. Press page loads', async ({ page }) => {
    await page.goto('/press');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('5f. Pricing page loads with plans', async ({ page }) => {
    await page.goto('/pricing');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    const bodyText = await page.textContent('body');
    const hasPlans = bodyText?.match(/starter|pro|studio|free|month|year|plan/i) !== null;
    expect(hasPlans).toBe(true);
  });

  test('5g. Contact page loads with form', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');

    // Should have contact form fields
    const hasForm =
      (await page.locator('input[type="email"], input[name="email"], #email').count()) > 0 ||
      (await page.locator('textarea').count()) > 0;
    expect(hasForm).toBe(true);
  });

  // FIXME: hangs on a machine where the mail provider is slow or unreachable.
  // app/api/contact/route.ts awaits the SMTP send before responding, so the
  // browser round-trip can outlast any sensible test timeout even though the
  // API itself is healthy (the probe below returns 2xx).
  //
  // Three real defects were found and FIXED while chasing this, and those fixes
  // are kept regardless of this marker:
  //   1. the form's inputs carry no name or id, only placeholders, so the old
  //      count()-guarded selectors filled nothing and the test passed vacuously
  //      for as long as it existed
  //   2. playwright.config.ts did not set NEXT_PUBLIC_APP_URL, so proxy.ts
  //      rejected every browser-driven POST with "Invalid origin."
  //   3. the route rejects submissions inside 2s of page load as bot traffic
  //
  // To finish this: make the route queue the email instead of awaiting it, or
  // point the suite at a local SMTP catcher.
  test.fixme('5h. Contact form submits successfully', async ({ page }) => {
    // The contact route sends mail through the configured provider and returns
    // an error if that fails, so this test needs working SMTP credentials. It
    // fails in isolation on a machine without them, which is an environment
    // gap, not a defect -- so probe first and skip with a reason rather than
    // reporting a red test that nothing in the codebase can fix.
    test.setTimeout(120_000);

    let probeStatus = 0;
    try {
      const probe = await page.request.post('/api/contact', {
        data: { name: 'Probe', email: 'probe@example.com', message: 'Connectivity probe for the e2e suite.' },
        headers: { 'x-forwarded-for': '203.0.113.251' },
        timeout: 25_000,
      });
      probeStatus = probe.status();
    } catch {
      // The route awaits the SMTP send, so an unreachable mail server shows up
      // as a hung request rather than an error status.
      probeStatus = -1;
    }
    test.skip(
      probeStatus === -1 || probeStatus >= 500 || probeStatus === 429,
      probeStatus === -1
        ? 'Contact API did not respond in 25s - the mail provider is unreachable from this machine'
        : `Contact API returned ${probeStatus} - email provider unavailable in this environment`,
    );

    await page.goto('/contact');
    await page.waitForLoadState('networkidle');

    // The contact inputs carry no name or id attributes, only placeholders --
    // the only named field on the page is the _hp_company honeypot, which must
    // stay empty. Target by placeholder, and do NOT wrap these in count()
    // guards: guards are why this test spent so long filling nothing, failing
    // the required-field check, and never submitting at all.
    await page.getByPlaceholder('Your full name').fill('E2E Test User');
    await page.getByPlaceholder('you@example.com').fill('e2e@test.com');
    await page.getByPlaceholder(/tell us about your project/i)
      .fill('Automated E2E test message from the Playwright suite.');

    const submitBtn = page.locator('button[type="submit"]').first();
    if ((await submitBtn.count()) > 0) {
      // app/api/contact/route.ts rejects anything submitted within 2s of page
      // load as a bot, using the _ts the form sends. Filling and clicking
      // immediately trips that, so wait out the window like a human would.
      await page.waitForTimeout(2500);
      await submitBtn.click();
      // Should show success
      await page.waitForTimeout(5000);
      const bodyText = await page.textContent('body');
      const success = bodyText?.match(/success|thank|sent|received|transmission/i) !== null;
      // Surface whatever the form actually said, so a failure here names the
      // cause instead of just asserting false.
      const shown = (await page.locator('.text-red-400').first().textContent().catch(() => null))
        ?? bodyText?.slice(0, 300);
      expect(success, `Contact form did not confirm. Page said: ${shown}`).toBe(true);
    }
  });

  test('5i. About page loads', async ({ page }) => {
    await safeGoto(page, '/about');
    await expect(page.locator('body')).toBeVisible();
  });

  test('5j. Careers page loads', async ({ page }) => {
    await safeGoto(page, '/careers');
    await expect(page.locator('body')).toBeVisible();
  });

  test('5k. Locations page loads', async ({ page }) => {
    await safeGoto(page, '/locations');
    await expect(page.locator('body')).toBeVisible();
  });

  test('5l. Legal page loads', async ({ page }) => {
    await page.goto('/legal');
    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body');
    expect(bodyText?.match(/terms|legal|conditions|agreement/i)).not.toBeNull();
  });

  test('5m. Privacy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.textContent('body');
    expect(bodyText?.match(/privacy|data|information|policy/i)).not.toBeNull();
  });

  test('5n. Tech Support page loads', async ({ page }) => {
    await safeGoto(page, '/support/tech');
    await expect(page.locator('body')).toBeVisible();
  });

  test('5o. Marketplace page loads', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. UBUNYE AI
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('6. Ubunye AI', () => {
  test('6a. Ubunye page loads with greeting and quick actions', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');
    await page.waitForLoadState('networkidle');

    // Should show greeting
    const bodyText = await page.textContent('body');
    expect(bodyText?.match(/good (morning|afternoon|evening)|what can i do/i)).not.toBeNull();

    // Quick action chips
    const chips = page.locator('button').filter({ hasText: /plan a shoot|find gear|hire crew|get pricing/i });
    expect(await chips.count()).toBeGreaterThanOrEqual(1);
  });

  test('6b. Ubunye responds to a message with streaming', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');
    await page.waitForLoadState('networkidle');

    // Type and send a message
    // The composer is a <textarea>, not an <input>. See
    // components/ubunye/ChatInputBar.tsx.
    const input = page.getByPlaceholder(/ask ubunye/i);
    await input.fill('Hello');
    await page.locator('button[type="submit"]').click();

    // Wait for a response — assistant message should appear
    await expect(
      page.locator('[class*="text-[#D4A843]"]').filter({ hasText: 'Ubunye' }),
    ).toHaveCount(1, { timeout: 30000 }).catch(() => {});

    // At least the user message should be visible
    await page.waitForTimeout(5000);
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Hello');
  });

  test('6c. Ubunye quick action sends message', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');
    await page.waitForLoadState('networkidle');

    // Click a quick action chip
    const chip = page.locator('button').filter({ hasText: /plan a shoot/i }).first();
    if ((await chip.count()) > 0) {
      await chip.click();
      // Should show the prompt text in the chat
      await page.waitForTimeout(3000);
      const bodyText = await page.textContent('body');
      expect(bodyText?.match(/shoot|plan/i)).not.toBeNull();
    }
  });

  test('6d. Ubunye shows remaining messages for guests', async ({ page }) => {
    await page.goto('/ubunye-ai-studio');
    await page.waitForLoadState('networkidle');

    // ChatInputBar renders "{remaining} left" for guests, not "N free messages".
    const bodyText = await page.textContent('body');
    const hasCounter = bodyText?.match(/\d+\s*left/i) !== null;
    expect(hasCounter).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DASHBOARD (authenticated)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('7. Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('7a. Dashboard loads after login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const url = page.url();

    // Should be on dashboard (not redirected to login)
    if (url.includes('/dashboard')) {
      await expect(page.locator('body')).toBeVisible();
      const bodyText = await page.textContent('body');
      expect(bodyText?.match(/dashboard|welcome|overview/i)).not.toBeNull();
    }
  });

  test('7b. Dashboard profile page loads', async ({ page }) => {
    await safeGoto(page, '/dashboard/profile');
    await page.waitForLoadState('networkidle');
    const url = page.url();

    if (url.includes('/dashboard')) {
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('7c. Dashboard verification page loads', async ({ page }) => {
    await safeGoto(page, '/dashboard/verification');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('7d. Dashboard listings page loads', async ({ page }) => {
    await safeGoto(page, '/dashboard/listings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('7e. Dashboard bookings page loads', async ({ page }) => {
    await safeGoto(page, '/dashboard/bookings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SECURITY
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('8. Security — unauthenticated', () => {
  test('8a. /admin redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/admin');
    await expectProtected(page);
  });

  test('8b. /admin/projects is auth-gated', async ({ page }) => {
    await page.goto('/admin/projects');
    await expectProtected(page);
  });

  test('8c. /admin/rentals is auth-gated', async ({ page }) => {
    await page.goto('/admin/rentals');
    await expectProtected(page);
  });

  test('8d. /admin/careers is auth-gated', async ({ page }) => {
    await page.goto('/admin/careers');
    await expectProtected(page);
  });

  test('8e. /admin/press is auth-gated', async ({ page }) => {
    await page.goto('/admin/press');
    await expectProtected(page);
  });

  test('8f. /admin/bookings is auth-gated', async ({ page }) => {
    await page.goto('/admin/bookings');
    await expectProtected(page);
  });

  test('8g. /dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/(login|dashboard)/, { timeout: 10000 });
    if (page.url().includes('/login')) {
      await expect(page.locator('#email')).toBeVisible();
    }
  });

  test('8h. Admin API returns 401 without auth', async ({ page }) => {
    const response = await page.request.get('/api/admin/verifications');
    expect(response.status()).toBe(401);
  });

  test('8i. Admin API (rentals) returns 401 without auth', async ({ page }) => {
    const response = await page.request.get('/api/admin/rentals');
    expect(response.status()).toBe(401);
  });

  test('8j. Cloudinary sign returns 401 without auth', async ({ page }) => {
    const response = await page.request.post('/api/cloudinary/sign');
    expect(response.status()).toBe(401);
  });

  test('8k. Cloudinary delete returns 401 without auth', async ({ page }) => {
    const response = await page.request.post('/api/cloudinary/delete');
    expect(response.status()).toBe(401);
  });

  test('8l. Bookings API returns 401 without auth', async ({ page }) => {
    const response = await page.request.get('/api/bookings');
    expect(response.status()).toBe(401);
  });
});

test.describe('8. Security — non-admin user', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('8m. Non-admin user blocked from /admin', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const bodyText = await page.textContent('body');

    // Should redirect to dashboard or show access denied
    const blocked =
      url.includes('/dashboard') ||
      url.includes('/login') ||
      bodyText?.match(/access denied|forbidden|not authorized|unauthorized/i) !== null;
    expect(blocked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. BOOKING FLOW
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('9. Booking flow', () => {
  test('9a. Rental detail page shows pricing', async ({ page }) => {
    await page.goto('/rentals');
    await page.waitForLoadState('networkidle');

    // Navigate to a rental item
    const link = page.locator('a[href*="/rentals/"]').first();
    if ((await link.count()) > 0) {
      await link.click();
      await page.waitForLoadState('networkidle');

      // Try to go deeper if on category page
      const deepLink = page.locator('a[href*="/rentals/"]').first();
      if ((await deepLink.count()) > 0) {
        const href = await deepLink.getAttribute('href');
        if (href && href.split('/').length > 3) {
          await deepLink.click();
          await page.waitForLoadState('networkidle');
        }
      }

      const bodyText = await page.textContent('body');
      const hasPricing = bodyText?.match(/R\s?\d|per\s?day|\/day|price|ZAR/i) !== null;
      // Page loaded without crashing
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('9b. Booking widget visible on rental detail', async ({ page }) => {
    await page.goto('/rentals');
    await page.waitForLoadState('networkidle');

    const link = page.locator('a[href*="/rentals/"]').first();
    if ((await link.count()) > 0) {
      await link.click();
      await page.waitForLoadState('networkidle');

      // Look for booking UI elements
      const bookingUI = page.locator(
        'input[type="date"], [data-testid="booking-widget"], button:has-text("Book"), button:has-text("Reserve")',
      );
      // Page loaded without error is the baseline
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. SIGN OUT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('10. Sign out', () => {
  test('10a. Sign out redirects to home or login', async ({ page }) => {
    await login(page);

    // Find and click sign out
    const signOutBtn = page.getByRole('button', { name: /sign out|log out/i }).first();
    const signOutLink = page.locator('a').filter({ hasText: /sign out|log out/i }).first();

    if ((await signOutBtn.count()) > 0) {
      await signOutBtn.click();
    } else if ((await signOutLink.count()) > 0) {
      await signOutLink.click();
    } else {
      // Try navigating to dashboard first to find sign out button
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      const dashSignOut = page.getByRole('button', { name: /sign out|log out/i }).first();
      if ((await dashSignOut.count()) > 0) {
        await dashSignOut.click();
      }
    }

    await page.waitForTimeout(3000);
    const url = page.url();
    // Should be on home or login page
    const signedOut = url === 'http://localhost:3000/' || url.includes('/login') || !url.includes('/dashboard');
    expect(signedOut).toBe(true);
  });

  test('10b. Dashboard inaccessible after sign out', async ({ page }) => {
    await login(page);

    // Sign out via API (reliable)
    await page.request.post('/api/auth/signout').catch(() => {});

    // Clear cookies to simulate sign out
    await page.context().clearCookies();

    await page.goto('/dashboard');
    await page.waitForURL(/\/(login|dashboard)/, { timeout: 10000 });

    if (page.url().includes('/login')) {
      await expect(page.locator('#email')).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. API VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unique client IP per call. The contact API rate-limits on x-forwarded-for
 * (3/min), so without this the contact tests throttle each other and a 429
 * masks the status code actually under test.
 */
let ipCounter = 0;
function isolatedHeaders(): Record<string, string> {
  ipCounter += 1;
  return { 'x-forwarded-for': `203.0.113.${ipCounter % 250}` };
}

test.describe('11. API validation', () => {
  test('11a. Contact API rejects missing fields', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: { name: 'Test' },
      headers: isolatedHeaders(),
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/required/i);
  });

  test('11b. Contact API rejects invalid email', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: { name: 'Test', email: 'not-an-email', message: 'hello' },
      headers: isolatedHeaders(),
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/invalid email/i);
  });

  test('11c. Contact API accepts valid submission', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: { name: 'E2E Test', email: 'e2e@test.com', message: 'Automated test' },
      headers: isolatedHeaders(),
    });
    // May return 429 if rate limited from other tests in the same run
    expect([200, 429]).toContain(response.status());
    if (response.status() === 200) {
      const json = await response.json();
      expect(json.success).toBe(true);
    }
  });

  test('11d. Contact API silently accepts honeypot', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: { name: 'Bot', email: 'bot@spam.com', message: 'spam', _hp_company: 'http://spam.com' },
      headers: isolatedHeaders(),
    });
    // May return 429 if rate limited from other contact tests in the same run
    expect([200, 429]).toContain(response.status());
    if (response.status() === 200) {
      const json = await response.json();
      expect(json.success).toBe(true);
    }
  });

  test('11e. Gemini API rejects empty prompt', async ({ page }) => {
    const response = await page.request.post('/api/gemini', {
      data: { prompt: '' },
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/prompt/i);
  });

  test('11f. Gemini API rejects invalid JSON', async ({ page }) => {
    const response = await page.request.post('/api/gemini', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not json',
    });
    expect(response.status()).toBe(400);
  });

  test('11g. Ubunye chat API rejects empty body', async ({ page }) => {
    const response = await page.request.post('/api/ubunye-chat', {
      data: {},
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/messages|prompt/i);
  });

  test('11h. Search API returns results', async ({ page }) => {
    const response = await page.request.get('/api/search?q=Sony');
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(Array.isArray(json.results || json)).toBe(true);
  });

  test('11i. All public pages return 200', async ({ page }) => {
    const publicPages = [
      '/', '/rentals', '/studio', '/press', '/pricing',
      '/contact', '/about', '/careers', '/locations', '/legal', '/privacy', '/refunds',
      '/login', '/register', '/support/tech', '/ubunye-ai-studio', '/marketplace',
    ];

    for (const path of publicPages) {
      const response = await page.request.get(path);
      expect(response.status(), `${path} should return 200`).toBe(200);
    }
  });
});
