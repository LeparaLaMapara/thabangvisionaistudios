/**
 * Journey F: admin access. LOCAL STACK ONLY (see README.md).
 */
import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers/env';
import { contextFor, makeAdmin, newAccount, type Account } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

let admin: Account;
let member: Account;

const ADMIN_PAGES: Array<[string, RegExp]> = [
  ['/admin/users', /user management/i],
  ['/admin/verifications', /identity verifications/i],
  ['/admin/bookings', /bookings/i],
  ['/admin/rental-ops', /rental ops/i],
  ['/admin/delivery-ops', /delivery ops/i],
  ['/admin/funnel', /funnel/i],
  ['/admin/flags', /feature flags/i],
];

const ADMIN_APIS = [
  '/api/admin/users',
  '/api/admin/verifications',
  '/api/admin/equipment-bookings',
  '/api/admin/rental-ops',
  '/api/admin/delivery',
  '/api/admin/listings/review',
  '/api/admin/service-bookings',
];

test.beforeAll(async ({ browser }) => {
  admin = await newAccount(browser, uniqueEmail('admin-f'), 'rent');
  makeAdmin(admin);
  member = await newAccount(browser, uniqueEmail('member-f'), 'rent');
});

test('signed out: /admin goes to sign in, and admin APIs answer 401', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
  for (const api of ADMIN_APIS) expect((await request.get(api)).status(), api).toBe(401);
});

test('a non-admin is sent away from /admin and gets 403 from /api/admin/*', async ({ browser }) => {
  const { context, page } = await contextFor(browser, member);
  for (const [path] of ADMIN_PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/dashboard|\/welcome|\/login/);
  }
  for (const api of ADMIN_APIS) expect((await page.request.get(api)).status(), api).toBe(403);
  // Writes too.
  expect((await page.request.post('/api/admin/delivery', { data: { action: 'run_jobs' } })).status()).toBe(403);
  expect((await page.request.patch('/api/admin/listings/review', { data: { id: '00000000-0000-4000-8000-000000000000', action: 'approve' } })).status()).toBe(403);
  await context.close();
});

test('an admin sees users, verifications, bookings, rental ops, delivery ops, funnel and flags', async ({ browser }) => {
  const { context, page } = await contextFor(browser, admin);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  for (const [path, heading] of ADMIN_PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(path));
    await expect(page.getByRole('heading', { name: heading }).first(), path).toBeVisible();
    await expect(page.getByText(/this page couldn.t load|application error/i)).toHaveCount(0);
  }
  for (const api of ADMIN_APIS) expect((await page.request.get(api)).status(), api).toBe(200);
  expect(errors).toEqual([]);
  // The users list includes the accounts made in this run.
  const users = JSON.stringify(await (await page.request.get('/api/admin/users')).json());
  expect(users).toContain(member.id);
  await context.close();
});
