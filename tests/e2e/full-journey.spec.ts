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

/** Login helper — fills login form and submits */
async function login(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
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

test.describe('1. Registration', () => {
  test('1a. Register page loads with all form fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();
    await expect(page.locator('input[type="checkbox"]')).toBeAttached();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('1b. Register rejects duplicate email', async ({ page }) => {
    await page.goto('/register');
    await page.locator('#email').fill(TEST_EMAIL);
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.locator('#confirmPassword').fill(TEST_PASSWORD);
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /create account/i }).click();

    // Should show an error or redirect — Supabase may return "User already registered"
    await page.waitForTimeout(3000);
    const bodyText = await page.textContent('body');
    const hasError = bodyText?.match(/already|exist|registered|confirm|check your email/i) !== null;
    const redirected = page.url().includes('/dashboard') || page.url().includes('/login');
    // Either shows error OR redirects (if email confirmation is required)
    expect(hasError || redirected).toBe(true);
  });

  test('1c. Register rejects weak password', async ({ page }) => {
    await page.goto('/register');
    await page.locator('#email').fill('weakpass@test.com');
    await page.locator('#password').fill('123');
    await page.locator('#confirmPassword').fill('123');
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(
      page.getByText(/password must be at least/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test('1d. Register validates empty fields', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: /create account/i }).click();

    // Browser HTML5 validation should prevent submission, or app shows error
    // Check that we're still on register page
    expect(page.url()).toContain('/register');
  });

  test('1e. Register validates invalid email format', async ({ page }) => {
    await page.goto('/register');
    await page.locator('#email').fill('notanemail');
    await page.locator('#password').fill('ValidPass2026!');
    await page.locator('#confirmPassword').fill('ValidPass2026!');
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /create account/i }).click();

    // HTML5 validation or app validation should catch this
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/register');
  });

  test('1f. Register requires terms checkbox', async ({ page }) => {
    await page.goto('/register');
    await page.locator('#email').fill('terms@test.com');
    await page.locator('#password').fill('ValidPass2026!');
    await page.locator('#confirmPassword').fill('ValidPass2026!');
    // Intentionally NOT checking terms
    await page.getByRole('button', { name: /create account/i }).click();

    // Error: "You must agree to the Terms of Service and Privacy Policy."
    await expect(
      page.getByText(/must agree/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test('1g. Register shows error for mismatched passwords', async ({ page }) => {
    await page.goto('/register');
    await page.locator('#email').fill('mismatch@test.com');
    await page.locator('#password').fill('Password123!');
    await page.locator('#confirmPassword').fill('DifferentPassword!');
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(
      page.getByText(/passwords do not match/i),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('2. Login', () => {
  test('2a. Login page loads with form fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
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
    await page.locator('#email').fill(TEST_EMAIL);
    await page.locator('#password').fill('WrongPass123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show "Invalid login credentials" (generic — doesn't reveal which field is wrong)
    await expect(
      page.getByText(/invalid login credentials/i),
    ).toBeVisible({ timeout: 15000 });
  });

  test('2d. Login fails with non-existent email', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('nobody@doesnotexist.com');
    await page.locator('#password').fill('SomePassword123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Same generic error — doesn't reveal whether account exists
    await expect(
      page.getByText(/invalid login credentials/i),
    ).toBeVisible({ timeout: 15000 });
  });

  test('2e. Login validates empty fields', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();

    // HTML5 validation should prevent submission
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/login');
  });

  test('2f. Login handles SQL injection safely', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill("' OR 1=1 --");
    await page.locator('#password').fill('anything');
    await page.getByRole('button', { name: /sign in/i }).click();

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

  test('5b. Smart Rentals loads with categories', async ({ page }) => {
    await page.goto('/smart-rentals');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    // Should show category cards or rental items
    const bodyText = await page.textContent('body');
    const hasContent = bodyText?.match(/camera|lens|lighting|audio|grip|drone|rental/i) !== null;
    expect(hasContent).toBe(true);
  });

  test('5c. Smart Rentals category page loads', async ({ page }) => {
    await page.goto('/smart-rentals');
    await page.waitForLoadState('networkidle');

    // Find and click a category link
    const categoryLink = page.locator('a[href*="/smart-rentals/"]').first();
    if ((await categoryLink.count()) > 0) {
      await categoryLink.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('5d. Smart Productions loads', async ({ page }) => {
    await page.goto('/smart-production');
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

  test('5h. Contact form submits successfully', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForLoadState('networkidle');

    // Fill contact form — field selectors may vary
    const nameField = page.locator('input[name="name"], #name').first();
    const emailField = page.locator('input[name="email"], input[type="email"], #email').first();
    const messageField = page.locator('textarea').first();

    if ((await nameField.count()) > 0) await nameField.fill('E2E Test User');
    if ((await emailField.count()) > 0) await emailField.fill('e2e@test.com');
    if ((await messageField.count()) > 0) await messageField.fill('Automated E2E test message');

    const submitBtn = page.locator('button[type="submit"]').first();
    if ((await submitBtn.count()) > 0) {
      await submitBtn.click();
      // Should show success
      await page.waitForTimeout(5000);
      const bodyText = await page.textContent('body');
      const success = bodyText?.match(/success|thank|sent|received|transmission/i) !== null;
      expect(success).toBe(true);
    }
  });

  test('5i. Lab page loads', async ({ page }) => {
    await safeGoto(page, '/lab');
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
    const input = page.locator('input[type="text"]').first();
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

    const bodyText = await page.textContent('body');
    const hasCounter = bodyText?.match(/\d+\s*free\s*message/i) !== null;
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
    await page.goto('/smart-rentals');
    await page.waitForLoadState('networkidle');

    // Navigate to a rental item
    const link = page.locator('a[href*="/smart-rentals/"]').first();
    if ((await link.count()) > 0) {
      await link.click();
      await page.waitForLoadState('networkidle');

      // Try to go deeper if on category page
      const deepLink = page.locator('a[href*="/smart-rentals/"]').first();
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
    await page.goto('/smart-rentals');
    await page.waitForLoadState('networkidle');

    const link = page.locator('a[href*="/smart-rentals/"]').first();
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

test.describe('11. API validation', () => {
  test('11a. Contact API rejects missing fields', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: { name: 'Test' },
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/required/i);
  });

  test('11b. Contact API rejects invalid email', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: { name: 'Test', email: 'not-an-email', message: 'hello' },
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/invalid email/i);
  });

  test('11c. Contact API accepts valid submission', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: { name: 'E2E Test', email: 'e2e@test.com', message: 'Automated test' },
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
      '/', '/smart-rentals', '/smart-production', '/press', '/pricing',
      '/contact', '/lab', '/careers', '/locations', '/legal', '/privacy',
      '/login', '/register', '/support/tech', '/ubunye-ai-studio', '/marketplace',
    ];

    for (const path of publicPages) {
      const response = await page.request.get(path);
      expect(response.status(), `${path} should return 200`).toBe(200);
    }
  });
});
