/**
 * Journey A: accounts. LOCAL STACK ONLY (see README.md).
 * Google sign-in is not covered: there is no Google locally.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { lit, one, rows, value } from './helpers/db';
import { APP, APP_LOG, latestMail, linkFrom, uniqueEmail } from './helpers/env';
import { followEmailLink, newContext, enterEmailCode, requestEmailCode, signUp, acceptTermsIfAsked, type Account } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

const email = uniqueEmail('renter-a');
const newPassword = 'Local-Reset-Pass-99';
let account: Account;

test('signed-out /dashboard sends you to /login?next=', async ({ page }) => {
  await page.goto('/dashboard/orders');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Forders/);
});

test('sign up with an email code, then accept the Terms on /welcome', async ({ page }) => {
  account = await signUp(page, email);
  const consents = rows<{ consent_purpose: string; source: string; document_version: string }>(
    `select consent_purpose, source, document_version from consent_records where user_id = ${lit(account.id)} order by 1`,
  );
  expect(consents.map((c) => c.consent_purpose)).toEqual(['privacy', 'terms']);
  expect(consents.every((c) => c.source === 'signup')).toBe(true);
  // A profile row exists for the new account.
  expect(value<number>(`select count(*) from profiles where id = ${lit(account.id)}`)).toBe(1);
});

test('sign out', async ({ page }) => {
  await page.goto('/login');
  const sent = await requestEmailCode(page, email);
  await enterEmailCode(page, page.request, email, sent);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('button', { name: /^sign out$/i }).first().click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('sign in with an email code honours next', async ({ page }) => {
  const sent = await requestEmailCode(page, email, '/login?next=%2Fdashboard%2Forders');
  await enterEmailCode(page, page.request, email, sent);
  await expect(page).toHaveURL(/\/dashboard\/orders/);
});

test('sign in with the link in the same email (auth callback) honours next', async ({ page }) => {
  const sent = await requestEmailCode(page, email, '/login?next=%2Fdashboard%2Fbookings');
  await followEmailLink(page, email, sent);
  await expect(page).toHaveURL(/\/dashboard\/bookings/);
});

test('an outside next (open redirect) is refused', async ({ page }) => {
  const sent = await requestEmailCode(page, email, '/login?next=https%3A%2F%2Fevil.example%2Fsteal');
  await enterEmailCode(page, page.request, email, sent);
  await acceptTermsIfAsked(page);
  expect(new URL(page.url()).host).toBe(new URL(APP).host);
  // Protocol-relative variant.
  await page.goto('/login?next=%2F%2Fevil.example');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  expect(new URL(page.url()).host).toBe(new URL(APP).host);
});

test('password reset email arrives and sets a password', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /use a password instead/i }).click();
  await page.getByRole('button', { name: /forgot password/i }).click();
  await page.locator('#resetEmail').fill(email);
  const sentAt = new Date();
  await page.getByRole('button', { name: /send reset link/i }).click();
  await expect(page.getByText(/we've sent a reset link/i)).toBeVisible();
  const mail = await latestMail(page.request, email, { after: sentAt, subject: /reset/i });
  const link = linkFrom(mail.html, 'type=recovery');
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password/);
  await page.locator('input[type="password"]').first().fill(newPassword);
  await page.getByRole('button', { name: /update password|set password|save/i }).click();
  await expect(page.getByText(/password (has been )?(updated|changed|set)/i)).toBeVisible();
  account = { ...account, password: newPassword };
});

test('password sign-in works with the new password', async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: /use a password instead/i }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(newPassword);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);
  await context.close();
});

test('wrong password and unknown email get the same generic error', async ({ page }) => {
  const attempt = async (address: string): Promise<string> => {
    await page.goto('/login');
    await page.getByRole('button', { name: /use a password instead/i }).click();
    await page.locator('#email').fill(address);
    await page.locator('#password').fill('Not-The-Password-1');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const alert = page.locator('#login-error');
    await expect(alert).toBeVisible();
    return (await alert.textContent()) ?? '';
  };
  const wrong = await attempt(email);
  const unknown = await attempt(uniqueEmail('nobody'));
  expect(wrong).toMatch(/invalid login credentials/i);
  expect(unknown).toBe(wrong);
});

test('phone verification with the SMS code from the server log', async ({ browser }) => {
  test.skip(!APP_LOG, 'APP_LOG (the app server log) not set');
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent = await requestEmailCode(page, email);
  await enterEmailCode(page, page.request, email, sent);
  const before = readFileSync(APP_LOG, 'utf8').length;
  const send = await page.request.post('/api/phone/send', { data: { phone: '082 555 0101' } });
  expect(send.status()).toBe(200);
  let code = '';
  for (let i = 0; i < 20 && !code; i++) {
    const m = readFileSync(APP_LOG, 'utf8').slice(before).match(/\[sms:log\] to \+2782\*+: (\d{6}) /);
    if (m) code = m[1];
    else await page.waitForTimeout(250);
  }
  expect(code, 'code printed to the server log').toMatch(/^\d{6}$/);
  const wrong = await page.request.post('/api/phone/verify', { data: { code: code === '000000' ? '111111' : '000000' } });
  expect(wrong.status()).toBeGreaterThanOrEqual(400);
  const ok = await page.request.post('/api/phone/verify', { data: { code } });
  expect(ok.status()).toBe(200);
  const profile = one<{ phone: string; phone_verified_at: string | null }>(
    `select phone, phone_verified_at from profiles where id = ${lit(account.id)}`,
  );
  expect(profile?.phone).toBe('+27825550101');
  expect(profile?.phone_verified_at).toBeTruthy();
  await context.close();
});
