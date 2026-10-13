/**
 * Journey S: Phase 6 security regressions, at the HTTP level, against the
 * real local stack. LOCAL STACK ONLY (see README.md). Each test replays the
 * attacker's reproduction from docs/security/phase-6-assessment.md and
 * asserts it no longer works.
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser } from '@playwright/test';
import { exec, lit, one, value } from './helpers/db';
import { ANON_KEY, APP, PAYSTACK_SECRET, SERVICE_KEY, SUPABASE_URL, uniqueEmail } from './helpers/env';
import { contextFor, makeAdmin, PASSWORD, type Account } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

const ADMIN_EMAIL = 'thabangvisionstudios@gmail.com'; // ADMIN_EMAILS[0] (lib/constants.ts)
const XSS = 'Jozi</script><script>window.__XSS_LOC__=1</script>';

// ─── helpers ────────────────────────────────────────────────────────────────

const svcHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

/** A confirmed account with a password, made through the local Auth admin API (fast). */
async function account(request: APIRequestContext, email = uniqueEmail('sec')): Promise<Account> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: svcHeaders,
    data: { email, password: PASSWORD, email_confirm: true },
  });
  let id: string | undefined = res.ok() ? ((await res.json()) as { id: string }).id : undefined;
  if (!id) id = value<string>(`select id::text from auth.users where lower(email) = lower(${lit(email)})`);
  expect(id, `account ${email}`).toBeTruthy();
  const set = await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: svcHeaders, data: { password: PASSWORD, email_confirm: true } });
  expect(set.ok(), 'set password').toBe(true);
  exec(`insert into public.profiles (id) values (${lit(id!)}) on conflict (id) do nothing;
        update public.profiles set popia_consent_at = coalesce(popia_consent_at, now()) where id = ${lit(id!)};`);
  return { email, id: id!, password: PASSWORD };
}

async function tokens(request: APIRequestContext, a: Account): Promise<{ access: string; refresh: string }> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY },
    data: { email: a.email, password: a.password },
  });
  expect(res.ok(), `password grant for ${a.email}`).toBe(true);
  const body = (await res.json()) as { access_token: string; refresh_token: string };
  return { access: body.access_token, refresh: body.refresh_token };
}

const rest = (access: string) => ({ apikey: ANON_KEY, authorization: `Bearer ${access}` });

function signedWebhook(body: unknown): { headers: Record<string, string>; data: string } {
  const data = JSON.stringify(body);
  return { headers: { 'content-type': 'application/json', 'x-paystack-signature': createHmac('sha512', PAYSTACK_SECRET).update(data).digest('hex') }, data };
}

async function signedIn(browser: Browser, a: Account) {
  return contextFor(browser, a);
}

// ─── INJ-1: stored XSS via JSON-LD ─────────────────────────────────────────

test('INJ-1: a creator location with </script> does not run on the public creator page', async ({ browser, request }) => {
  const creator = await account(request);
  const slug = `xss-${creator.id.slice(0, 8)}`;
  // A value stored before 079 (the markup trigger is off for this one write).
  exec(`
    alter table public.profiles disable trigger profiles_reject_markup;
    update public.profiles set crew_slug = ${lit(slug)}, display_name = 'Xss Tester', verification_status = 'verified',
      is_verified = true, available_for_hire = true, specializations = array['Photography'], location = ${lit(XSS)},
      portfolio_projects = '[{"id":"p1","title":"t","photos":[{"url":"https://res.cloudinary.com/x/image/upload/a.jpg"},{"url":"https://res.cloudinary.com/x/image/upload/b.jpg"},{"url":"https://res.cloudinary.com/x/image/upload/c.jpg"}]}]'::jsonb
     where id = ${lit(creator.id)};
    alter table public.profiles enable trigger profiles_reject_markup;`);

  const context = await browser.newContext({ baseURL: APP });
  const page = await context.newPage();
  const res = await page.goto(`/studio/category/photography/${slug}`);
  expect(res?.status()).toBe(200);
  expect(await page.evaluate(() => (window as unknown as { __XSS_LOC__?: number }).__XSS_LOC__ ?? null)).toBeNull();
  // The data is intact for search engines: the JSON-LD parses back to the stored value.
  const localities = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => { try { return (JSON.parse(s.textContent ?? '') as { address?: { addressLocality?: string } }).address?.addressLocality ?? null; } catch { return 'PARSE_ERROR'; } })
      .filter(Boolean));
  expect(localities).toContain(XSS);
  expect(await page.content()).not.toContain('</script><script>window.__XSS_LOC__');
  await context.close();
  exec(`update public.profiles set available_for_hire = false where id = ${lit(creator.id)};`);
});

test('INJ-1: the payload is refused on both write paths (onboarding API, direct REST)', async ({ browser, request }) => {
  const user = await account(request);
  const { context, page } = await signedIn(browser, user);
  const res = await page.request.post('/api/onboarding', {
    data: { firstName: 'Thandi', lastName: 'Nkosi', phone: '0821234567', streetAddress: '1 Main Road', city: XSS, province: 'Gauteng', avatarUrl: 'https://res.cloudinary.com/x/image/upload/a.jpg' },
  });
  expect(res.status()).toBe(400);
  await context.close();

  const { access } = await tokens(request, user);
  const direct = await request.patch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, { headers: rest(access), data: { location: XSS } });
  expect(direct.ok()).toBe(false);
  expect(value<string | null>(`select location from public.profiles where id = ${lit(user.id)}`)).not.toBe(XSS);
});

// ─── INJ-2: SSRF through the portfolio analyser ────────────────────────────

test('INJ-2: analyze-portfolio no longer makes the server fetch an internal address', async ({ browser, request }) => {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => { hits.push(req.url ?? ''); res.end('x'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const user = await account(request);
    const { context, page } = await signedIn(browser, user);
    for (const url of [`http://127.0.0.1:${port}/ssrf-INTERNAL-REACHED`, `https://127.0.0.1:${port}/x`, 'http://169.254.169.254/latest/meta-data/']) {
      const res = await page.request.post('/api/agents/portfolios', { data: { action: 'analyze-portfolio', imageUrls: [url] } });
      expect(res.status(), url).toBe(400);
    }
    await new Promise((r) => setTimeout(r, 500));
    expect(hits).toEqual([]);
    await context.close();
  } finally {
    server.close();
  }
});

// ─── INJ-5: upload signing ─────────────────────────────────────────────────

test('INJ-5: the signer ignores client public_id/folder and refuses raw uploads', async ({ browser, request }) => {
  const user = await account(request);
  const { context, page } = await signedIn(browser, user);
  const res = await page.request.post('/api/cloudinary/sign', {
    data: { paramsToSign: { folder: 'thabangvision_usecase/media/listings/clean', public_id: 'victim/photo', overwrite: 'true', resource_type: 'image' } },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { folder: string; params: Record<string, string> };
  expect(body.folder.startsWith(`thabangvision_usecase/users/${user.id}/`)).toBe(true);
  expect(Object.keys(body.params).sort()).toEqual(['allowed_formats', 'folder', 'timestamp']);
  expect((await page.request.post('/api/cloudinary/sign', { data: { paramsToSign: { folder: 'x', resource_type: 'raw' } } })).status()).toBe(400);
  await context.close();
});

// ─── MONEY-1 / MONEY-2: service-booking payment webhook ─────────────────────

test('MONEY-1/2: a signed R1 charge neither confirms an R5 000 booking nor revives a refunded one', async ({ request }) => {
  const client = await account(request);
  const creator = await account(request);
  const tag = Date.now().toString(36).toUpperCase();
  const seed = (ref: string, total: number, status: string, paymentStatus: string) => exec(`
    insert into public.bookings (reference, project_description, deliverables, platform_amount, creator_amount, client_email,
      client_id, creator_id, booking_type, project_category, duration_hours, subtotal, vat, total, status, payment_status)
    values (${lit(ref)}, 'sec test', 'photos', 0, ${total}, ${lit(client.email)}, ${lit(client.id)}, ${lit(creator.id)},
      'production', 'Photography', 4, ${total}, 0, ${total}, ${lit(status)}, ${lit(paymentStatus)});`);
  const amt = `BK-SEC-AMT-${tag}`;
  const res = `BK-SEC-RES-${tag}`;
  const ok = `BK-SEC-OK-${tag}`;
  seed(amt, 5000, 'pending', 'unpaid');
  seed(res, 10000, 'cancelled', 'refunded');
  seed(ok, 3000, 'pending', 'unpaid');
  const charge = (reference: string, cents: number, id: number) => signedWebhook({
    event: 'charge.success',
    data: { id, reference, amount: cents, currency: 'ZAR', status: 'success', metadata: { customStr1: 'service_booking' } },
  });
  const base = Number(`9${Date.now() % 1_000_000_000}`);
  for (const [ref, cents, i] of [[amt, 100, 1], [res, 100, 2], [ok, 300000, 3]] as const) {
    const r = await request.post('/api/webhooks/paystack', charge(ref, cents, base + i));
    expect(r.status(), ref).toBe(200);
  }
  await expect.poll(() => one<{ status: string }>(`select status from public.bookings where reference = ${lit(ok)}`)?.status, { timeout: 15_000 }).toBe('paid');
  expect(one(`select status, payment_status from public.bookings where reference = ${lit(amt)}`)).toEqual({ status: 'pending', payment_status: 'unpaid' });
  expect(one(`select status, payment_status from public.bookings where reference = ${lit(res)}`)).toEqual({ status: 'cancelled', payment_status: 'refunded' });
});

// ─── AUTH-1: ADMIN_EMAILS break-glass ──────────────────────────────────────

test('AUTH-1: a session under the ADMIN_EMAILS address with an unconfirmed email is not admin', async ({ browser, request }) => {
  const owner = await account(request, ADMIN_EMAIL);
  exec(`update public.profiles set role = 'user' where id = ${lit(owner.id)};
        update auth.users set raw_app_meta_data = raw_app_meta_data - 'role' where id = ${lit(owner.id)};`);
  const { context, page } = await signedIn(browser, owner);
  try {
    // Confirmed: the break-glass still works (no lockout).
    expect((await page.request.get('/api/admin/users')).status()).toBe(200);
    exec(`update auth.users set email_confirmed_at = null where id = ${lit(owner.id)};`);
    expect((await page.request.get('/api/admin/users')).status()).toBe(403);
    expect((await page.request.patch(`/api/admin/users/${owner.id}/role`, { data: { role: 'admin' } })).status()).toBe(403);
  } finally {
    exec(`update auth.users set email_confirmed_at = now() where id = ${lit(owner.id)};`);
    await context.close();
  }
});

// ─── AUTH-2 / AUTH-3: role change and suspension end sessions ──────────────

test('AUTH-2: a demoted admin\'s old token loses admin over REST/RPC at once', async ({ browser, request }) => {
  const boss = await account(request);
  makeAdmin(boss);
  const target = await account(request);
  const { context, page } = await signedIn(browser, boss);
  expect((await page.request.patch(`/api/admin/users/${target.id}/role`, { data: { role: 'admin' } })).status()).toBe(200);
  const t = await tokens(request, target);
  expect(await (await request.post(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, { headers: rest(t.access), data: {} })).json()).toBe(true);

  const demote = await page.request.patch(`/api/admin/users/${target.id}/role`, { data: { role: 'user' } });
  expect(demote.status()).toBe(200);
  expect(((await demote.json()) as { sessions_revoked: boolean }).sessions_revoked).toBe(true);
  await context.close();

  expect(await (await request.post(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, { headers: rest(t.access), data: {} })).json()).toBe(false);
  const verifs = await request.post(`${SUPABASE_URL}/rest/v1/rpc/admin_list_verifications`, { headers: rest(t.access), data: {} });
  expect(verifs.ok()).toBe(false);
  expect((await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers: rest(t.access) })).status()).toBe(403);
  const refresh = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { headers: { apikey: ANON_KEY }, data: { refresh_token: t.refresh } });
  expect(refresh.ok()).toBe(false);
});

test('AUTH-2 (review): an app_metadata-only admin demoted through the app loses admin at once', async ({ browser, request }) => {
  const boss = await account(request);
  makeAdmin(boss);
  const legacy = await account(request);
  // Admin only in app_metadata (made by hand before 079); the profile says 'user'.
  exec(`update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb where id = ${lit(legacy.id)};`);
  const t = await tokens(request, legacy);
  expect(await (await request.post(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, { headers: rest(t.access), data: {} })).json()).toBe(true);

  const { context, page } = await signedIn(browser, boss);
  expect((await page.request.patch(`/api/admin/users/${legacy.id}/role`, { data: { role: 'user' } })).status()).toBe(200);
  await context.close();
  expect(await (await request.post(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, { headers: rest(t.access), data: {} })).json()).toBe(false);
});

test('AUTH-3: a suspended user is signed out and cannot write their cart over REST', async ({ browser, request }) => {
  const boss = await account(request);
  makeAdmin(boss);
  const user = await account(request);
  const victim = await signedIn(browser, user);
  const t = await tokens(request, user);
  expect((await victim.page.request.get('/api/auth/me')).status()).toBe(200);

  const admin = await signedIn(browser, boss);
  const s = await admin.page.request.post(`/api/admin/users/${user.id}/suspend`, { data: { reason: 'security journey' } });
  expect(s.status()).toBe(200);
  expect(((await s.json()) as { sessions_revoked: boolean }).sessions_revoked).toBe(true);
  await admin.context.close();

  expect((await victim.page.request.get('/api/auth/me')).status()).toBe(401);
  await victim.context.close();
  const rental = value<string>(`select id::text from public.smart_rentals where is_published and deleted_at is null limit 1`);
  if (rental) {
    const cart = await request.post(`${SUPABASE_URL}/rest/v1/cart_items`, { headers: rest(t.access), data: { user_id: user.id, rental_id: rental, quantity: 1 } });
    expect(cart.ok()).toBe(false);
  }
  expect(value<number>(`select count(*) from public.cart_items where user_id = ${lit(user.id)}`)).toBe(0);
});

test('Codex P1: a suspended admin cannot sign in again, and is not admin even with a session', async ({ browser, request }) => {
  const boss = await account(request);
  makeAdmin(boss);
  const target = await account(request);
  makeAdmin(target);
  const admin = await signedIn(browser, boss);
  const s = await admin.page.request.post(`/api/admin/users/${target.id}/suspend`, { data: { reason: 'security journey: suspended admin' } });
  expect(s.status()).toBe(200);
  expect(((await s.json()) as { sign_in_blocked: boolean }).sign_in_blocked).toBe(true);
  await admin.context.close();

  // The Auth ban: password sign-in is refused.
  const grant = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { headers: { apikey: ANON_KEY }, data: { email: target.email, password: target.password } });
  expect(grant.ok()).toBe(false);

  // Even with a session (ban lifted out of band, e.g. it failed), the app refuses admin.
  const lift = await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${target.id}`, { headers: svcHeaders, data: { ban_duration: 'none' } });
  expect(lift.ok()).toBe(true);
  const again = await signedIn(browser, target);
  expect((await again.page.request.get('/api/admin/users')).status()).toBe(403);
  expect((await again.page.request.patch(`/api/admin/users/${boss.id}/role`, { data: { role: 'user' } })).status()).toBe(403);
  await again.context.close();
});

// ─── AUTH-4: CSRF without an Origin header ────────────────────────────────

test('AUTH-4: a cookie-authenticated POST with no Origin and no Referer is refused', async ({ browser, request }) => {
  const user = await account(request);
  const { context } = await signedIn(browser, user);
  const state = await context.storageState();
  await context.close();
  // A request context that sends the session cookie but no Origin/Referer.
  // extraHTTPHeaders: {} drops the config's Referer header for this context.
  const bare = await playwrightRequest.newContext({ baseURL: APP, storageState: state, extraHTTPHeaders: {} });
  try {
    expect((await bare.post('/api/notifications/mark-all-read')).status()).toBe(403);
    expect((await bare.post('/api/notifications/mark-all-read', { headers: { referer: 'https://evil.example/' } })).status()).toBe(403);
    expect((await bare.post('/api/notifications/mark-all-read', { headers: { origin: 'null' } })).status()).toBe(403);
    expect((await bare.post('/api/notifications/mark-all-read', { headers: { referer: `${APP}/dashboard` } })).status()).toBe(200);
  } finally {
    await bare.dispose();
  }
});

// ─── LLM-4: oversized chat message ─────────────────────────────────────────

test('LLM-4: a 2 MB chat message is refused before any model call', async ({ request }) => {
  const res = await request.post('/api/ubunye-chat', {
    data: { messages: [{ role: 'user', parts: [{ type: 'text', text: 'x'.repeat(2_000_000) }] }], sessionMessageCount: 0 },
  });
  expect(res.status()).toBe(413);
});
