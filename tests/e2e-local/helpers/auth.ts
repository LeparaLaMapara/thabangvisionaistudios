/**
 * LOCAL STACK ONLY: account helpers for the journey specs. Accounts are made
 * through the real sign-in screen (email code read from Mailpit). Only things
 * a person cannot do from the UI (make an admin, set a password for a later
 * fast sign-in) use the local service key.
 */
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { exec, lit, value } from './db';
import { APP, latestMail, linkFrom, SERVICE_KEY, SUPABASE_URL } from './env';

export const PASSWORD = 'Journey-Local-2026!';

export interface Account {
  email: string;
  id: string;
  password: string;
}

/** Ask for a sign-in email on /login and return when the code step shows. */
export async function requestEmailCode(page: Page, email: string, path = '/login'): Promise<Date> {
  await page.goto(path);
  await page.locator('#email').fill(email);
  const sentAt = new Date();
  await page.getByRole('button', { name: /continue with email/i }).click();
  await expect(page.locator('#code')).toBeVisible();
  return sentAt;
}

/**
 * The 6-digit code for an address. The email must have arrived in Mailpit;
 * the code is read from it when the template carries one. The local Supabase
 * templates (like the hosted ones until risk R-33 is done) only carry the
 * link, so the code is then minted through the local Auth admin API, which
 * replaces the emailed one exactly as a "send a new email" would.
 */
export async function emailCode(request: APIRequestContext, email: string, after: Date): Promise<string> {
  const mail = await latestMail(request, email, { after });
  const inMail = mail.text.match(/\b(\d{6,10})\b/);
  if (inMail) return inMail[1];
  const res = await request.post(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    data: { type: 'magiclink', email },
  });
  expect(res.ok(), 'generate_link').toBe(true);
  const body = (await res.json()) as { email_otp?: string; properties?: { email_otp?: string } };
  const code = body.email_otp ?? body.properties?.email_otp;
  expect(code, 'email_otp').toBeTruthy();
  return code as string;
}

/** Type the code for the newest sign-in email into the code step. */
export async function enterEmailCode(page: Page, request: APIRequestContext, email: string, after: Date): Promise<void> {
  await page.locator('#code').fill(await emailCode(request, email, after));
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

/** Follow the sign-in link in the newest email (same browser: PKCE). */
export async function followEmailLink(page: Page, email: string, after: Date): Promise<void> {
  const mail = await latestMail(page.request, email, { after });
  const link = linkFrom(mail.html, '/auth/v1/verify');
  await page.goto(link);
  await page.waitForURL((u) => u.host === new URL(APP).host && !u.pathname.startsWith('/auth/'), { timeout: 30_000 });
}

/** Tap "I agree" on /welcome when it asks. */
export async function acceptTermsIfAsked(page: Page): Promise<void> {
  if (!page.url().includes('/welcome')) return;
  const agree = page.getByRole('button', { name: /i agree/i });
  if (await agree.isVisible().catch(() => false)) {
    await agree.click();
    await page.waitForLoadState('networkidle');
  }
}

/** Sign up through the real flow: email code, then the /welcome Terms tap. */
export const WELCOME_CHOICE = {
  rent: /rent camera gear/i,
  hire: /book a photographer or videographer/i,
  list: /list my gear/i,
  supply: /offer my services/i,
} as const;

export async function signUp(page: Page, email: string, intent: keyof typeof WELCOME_CHOICE = 'rent'): Promise<Account> {
  const sent = await requestEmailCode(page, email);
  await enterEmailCode(page, page.request, email, sent);
  await expect(page).toHaveURL(/\/welcome/);
  await acceptTermsIfAsked(page);
  // "What did you come to do?" (one tap).
  const choice = page.getByRole('button', { name: WELCOME_CHOICE[intent] });
  await choice.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 30_000 });
  const id = value<string>(`select id::text from auth.users where email = ${lit(email)}`);
  expect(id, 'auth user created').toBeTruthy();
  return { email, id, password: '' };
}

/** Give an account a password through the local Auth admin API (seeding only). */
export async function setPassword(request: APIRequestContext, account: Account, password = PASSWORD): Promise<Account> {
  const res = await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${account.id}`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    data: { password },
  });
  expect(res.ok(), 'set password').toBe(true);
  return { ...account, password };
}

/** Make an account an admin the way the founder does: role on profiles and app_metadata. */
export function makeAdmin(account: Account): void {
  exec(`
    update public.profiles set role = 'admin' where id = ${lit(account.id)};
    update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
     where id = ${lit(account.id)};`);
}

/** Password sign-in through the UI. */
export async function signInWithPassword(page: Page, account: Account, next?: string): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByRole('button', { name: /use a password instead/i }).click();
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await acceptTermsIfAsked(page);
}

/** A fresh browser context with the local options (see playwright.config.ts). */
export async function newContext(browser: Browser): Promise<BrowserContext> {
  // extraHTTPHeaders: see playwright.config.ts (CSRF, security AUTH-4).
  return browser.newContext({ baseURL: APP, bypassCSP: true, extraHTTPHeaders: { Referer: `${new URL(APP).origin}/` } });
}

/** A fresh browser context signed in as the account. */
export async function contextFor(browser: Browser, account: Account): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await signInWithPassword(page, account);
  return { context, page };
}

/** A new account through the real sign-up flow, with a password for later fast sign-ins. */
export async function newAccount(
  browser: Browser,
  email: string,
  intent: keyof typeof WELCOME_CHOICE = 'rent',
): Promise<Account> {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    const account = await signUp(page, email, intent);
    return await setPassword(page.request, account);
  } finally {
    await context.close();
  }
}

/** A user's access token (for calling Supabase REST as that user). */
export async function accessToken(request: APIRequestContext, account: Account, anonKey: string): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: account.email, password: account.password },
  });
  expect(res.ok(), 'password grant').toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}
