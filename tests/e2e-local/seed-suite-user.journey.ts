/**
 * LOCAL STACK ONLY: the account tests/e2e/full-journey.spec.ts signs in with,
 * made through the real sign-up flow so the default suite's login tests can
 * run against the local stack. Idempotent: an existing account only gets its
 * password (re)set.
 */
import { test, expect } from '@playwright/test';
import { lit, value } from './helpers/db';
import { newContext, setPassword, signUp } from './helpers/auth';

// Must match tests/e2e/full-journey.spec.ts.
const SUITE_EMAIL = 'thabangvisionstudios+testuser@gmail.com';
const SUITE_PASSWORD = 'TestUser2026!';

test('the default suite\'s test account exists locally with its password', async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  let id = value<string | null>(`select id::text from auth.users where email = ${lit(SUITE_EMAIL)}`);
  if (!id) id = (await signUp(page, SUITE_EMAIL, 'rent')).id;
  await setPassword(page.request, { email: SUITE_EMAIL, id, password: '' }, SUITE_PASSWORD);
  expect(value<number>(`select count(*) from consent_records where user_id = ${lit(id)} and consent_purpose = 'terms'`)).toBeGreaterThan(0);
  await context.close();
});
