/**
 * Journey C: a community owner lists gear, an admin reviews it, a renter
 * hires it, and the owner is paid. LOCAL STACK ONLY (see README.md).
 *
 * Photos go to the stub Cloudinary (helpers/storage.ts, harness/preload.cjs).
 * AI suggestions need Anthropic/Gemini, which are unreachable here: the test
 * checks the page falls back to filling in by hand.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { exec, lit, one, unbalancedJournals, value } from './helpers/db';
import { ANON_KEY, SUPABASE_URL, notifyStubTransfers, runCron, settleStubRefunds, stubLog, stubTx, uniqueEmail } from './helpers/env';
import { accessToken, contextFor, makeAdmin, newAccount, type Account } from './helpers/auth';
import { addValidatedBank, approveIdInAdmin, setLegalName, submitIdWithoutUpload, verifyPhone, ymd } from './helpers/flows';
import { payOnStub, routeCheckoutToStub } from './helpers/pay';
import { PHOTO, routeCloudinaryToStub } from './helpers/storage';
import { addToCartAt, checkoutFromCart, groupFrom, intentFor, readyRenter } from './helpers/rental';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const title = `Journey Owner Lens ${run}`;
let admin: Account;
let owner: Account;
let renter: Account;
let ownerCtx: BrowserContext;
let op: Page;
let listingId = '';
let slug = '';

test.beforeAll(async ({ browser }) => {
  admin = await newAccount(browser, uniqueEmail('admin-c'), 'rent');
  makeAdmin(admin);
});

test.afterAll(async () => {
  await ownerCtx?.close();
});

test('owner signs up ("List my gear") and gets ready: phone, ID approved, payout bank validated', async ({ browser }) => {
  owner = await newAccount(browser, uniqueEmail('owner-c'), 'list');
  ({ context: ownerCtx, page: op } = await contextFor(browser, owner));
  await routeCloudinaryToStub(ownerCtx);
  await verifyPhone(op.request, '082 555 0303');
  setLegalName(owner, 'Olwethu', `Owner${run}`);
  submitIdWithoutUpload(owner, `Olwethu Owner${run}`);
  const a = await contextFor(browser, admin);
  await approveIdInAdmin(a.page, `Olwethu Owner${run}`, owner.id);
  await a.context.close();
  await addValidatedBank(op.request, `Olwethu Owner${run}`);
  expect(value<boolean>(`select is_verified from banking_details where user_id = ${lit(owner.id)}`)).toBe(true);
});

test('AI suggestion from the photo fails gracefully (AI providers unreachable locally)', async () => {
  await op.goto('/dashboard/listings?new=1');
  await op.locator('#listing-photos').setInputFiles(PHOTO);
  await expect(op.getByRole('img', { name: 'Cover photo' })).toBeVisible();
  await op.getByRole('button', { name: /suggest details from photo/i }).click();
  // The page carries on to the form, to fill in by hand; never a stack trace.
  await expect(op.locator('#listing-title')).toBeVisible({ timeout: 90_000 });
  const body = (await op.textContent('body')) ?? '';
  expect(body).not.toMatch(/TypeError|at \S+ \(|node_modules/);
});

test('owner fills in the listing, saves, and submits it for review', async () => {
  await op.locator('#listing-title').fill(title);
  await op.locator('#listing-category').selectOption('cameras-optics');
  await op.locator('#listing-brand').fill('Journey');
  await op.locator('#listing-model').fill(`L-${run}`);
  await op.locator('#listing-condition').selectOption({ index: 1 });
  await op.locator('#listing-day-rate').fill('150');
  await op.locator('#listing-replacement-value').fill('1800');
  await op.locator('#listing-location').fill('Braamfontein, Johannesburg');
  await op.locator('#listing-description').fill('A sharp prime lens, cleaned and checked after every hire. Comes with caps and a pouch.');
  await op.getByRole('button', { name: /save and continue/i }).click();
  await expect(op.getByRole('button', { name: /submit for review|publish/i })).toBeVisible({ timeout: 30_000 });
  const row = one<{ id: string; slug: string; listing_status: string; owner_type: string; owner_id: string; is_published: boolean }>(
    `select id::text, slug, listing_status, owner_type, owner_id::text, is_published from smart_rentals where title = ${lit(title)}`,
  )!;
  listingId = row.id;
  slug = row.slug;
  expect(row).toMatchObject({ listing_status: 'draft', owner_type: 'community', owner_id: owner.id, is_published: false });
  for (const box of await op.getByRole('checkbox').all()) await box.check();
  await op.getByRole('button', { name: /submit for review/i }).click();
  await expect
    .poll(() => value<string>(`select listing_status from smart_rentals where id = ${lit(listingId)}`), { timeout: 30_000 })
    .toBe('pending_review');
  expect(value<boolean>(`select is_published from smart_rentals where id = ${lit(listingId)}`)).toBe(false);
});

test('the owner cannot publish their own listing or change privileged fields', async ({ request }) => {
  const token = await accessToken(request, owner, ANON_KEY);
  const rest = (method: 'PATCH' | 'POST', path: string, data: unknown) =>
    request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
      data,
    });
  for (const patch of [
    { listing_status: 'published' },
    { is_published: true },
    { owner_id: admin.id },
    { owner_type: 'studio' },
    { is_featured: true, ranking_score: 999 },
    { price_per_day: 1 },
  ]) {
    const res = await rest('PATCH', `smart_rentals?id=eq.${listingId}`, patch);
    // Refused outright, or no row the owner may change.
    if (res.ok()) expect(await res.json(), JSON.stringify(patch)).toEqual([]);
    else expect(res.status(), JSON.stringify(patch)).toBeGreaterThanOrEqual(400);
  }
  const insert = await rest('POST', 'smart_rentals', { slug: `x-${run}`, title: 'Sneaky', category: 'audio', owner_type: 'community', owner_id: owner.id, listing_status: 'published', is_published: true });
  expect(insert.status()).toBeGreaterThanOrEqual(400);
  // Through the app's own API: only an owner's own fields, never the status.
  const put = await op.request.put('/api/listings', { data: { id: listingId, listing_status: 'published', is_published: true, owner_id: admin.id, owner_type: 'studio' } });
  expect(put.status()).not.toBe(500);
  const row = one<{ listing_status: string; is_published: boolean; owner_id: string; owner_type: string; price_per_day: number }>(
    `select listing_status, is_published, owner_id::text, owner_type, price_per_day::float as price_per_day from smart_rentals where id = ${lit(listingId)}`,
  )!;
  expect(row).toMatchObject({ is_published: false, owner_id: owner.id, owner_type: 'community', price_per_day: 150 });
  expect(row.listing_status).not.toBe('published');
});

test('an admin approves it in /admin/listings and it goes live', async ({ browser }) => {
  // The PUT above may have moved it back to draft (an edit withdraws it); submit again if so.
  if (value<string>(`select listing_status from smart_rentals where id = ${lit(listingId)}`) !== 'pending_review') {
    const r = await op.request.post(`/api/listings/${listingId}/submit`);
    expect(r.status(), await r.text()).toBeLessThan(300);
  }
  const { context, page } = await contextFor(browser, admin);
  await page.goto('/admin/listings');
  const card = page.locator('li, article, div').filter({ hasText: title }).last();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /approve/i }).click();
  await expect
    .poll(() => value<string>(`select listing_status from smart_rentals where id = ${lit(listingId)}`), { timeout: 15_000 })
    .toBe('published');
  await context.close();
  expect(value<boolean>(`select is_published from smart_rentals where id = ${lit(listingId)}`)).toBe(true);
  slug = value<string>(`select slug from smart_rentals where id = ${lit(listingId)}`);
});

let group = '';
let bookingId = '';
test('a renter hires it and pays', async ({ browser }) => {
  renter = await readyRenter(browser, admin, 'renter-c', '082 555 0304');
  const { context, page } = await contextFor(browser, renter);
  await routeCheckoutToStub(context);
  await addToCartAt(page, { category: 'cameras-optics', slug }, ymd(5), ymd(7));
  await checkoutFromCart(page);
  const reference = await payOnStub(page);
  group = groupFrom(page, 'checkout');
  await expect.poll(() => intentFor(group)?.state, { timeout: 20_000 }).toBe('paid');
  const intent = intentFor(group)!;
  expect(intent.expected_amount_cents).toBe((await stubTx(page.request, reference))!.amount);
  expect(intent.hire_cents).toBe(30000); // 2 days x R150
  expect(intent.deposit_cents).toBe(45000); // 25% of R1,800
  const line = one<{ id: string; status: string; ownership: string; owner_id: string }>(
    `select id::text, status, ownership, owner_id::text from equipment_bookings where checkout_group_id = ${lit(group)}`,
  )!;
  expect(line).toMatchObject({ status: 'confirmed', ownership: 'community', owner_id: owner.id });
  bookingId = line.id;
  expect(unbalancedJournals()).toEqual([]);
  await context.close();
});

test('staff hand over and take back in admin; the owner payout goes out after the delay', async ({ browser, request }) => {
  const { context, page } = await contextFor(browser, admin);
  await routeCloudinaryToStub(context);
  // Handover (/admin/rentals/[id]/handover). The hire starts in the future; staff hand over early.
  await page.goto(`/admin/rentals/${bookingId}/handover`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByPlaceholder(/the studio counter/i).fill('Studio counter');
  await page.locator('select').first().selectOption({ index: 1 });
  await page.locator('input[type="file"]').first().setInputFiles(PHOTO);
  await expect(page.getByText(/1 photo\(s\) added/i)).toBeVisible();
  await page.locator('input[type="file"]').nth(1).setInputFiles(PHOTO);
  await expect(page.getByText(/retake renter photo/i)).toBeVisible();
  const pad = page.getByLabel('Signature pad');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: /hand over and start the hire/i }).click();
  await expect.poll(() => value<string>(`select status from equipment_bookings where id = ${lit(bookingId)}`), { timeout: 20_000 }).toBe('active');

  // Return and inspection (/admin/rentals/[id]/return).
  await page.goto(`/admin/rentals/${bookingId}/return`);
  await page.locator('select').first().selectOption({ index: 1 });
  await page.locator('input[type="file"]').first().setInputFiles(PHOTO);
  await expect(page.getByText(/1 photo\(s\) added/i)).toBeVisible();
  for (const b of await page.getByRole('checkbox').all()) await b.check();
  await page.getByRole('button', { name: /^works/i }).first().click();
  await page.getByRole('button', { name: /complete the return/i }).click();
  await expect.poll(() => value<string>(`select status from equipment_bookings where id = ${lit(bookingId)}`), { timeout: 20_000 }).toBe('completed');
  await context.close();

  const payout = one<{ state: string; owner_amount_cents: number; gross_rental_amount_cents: number; platform_commission_cents: number; transfer_reference: string }>(
    `select state, owner_amount_cents, gross_rental_amount_cents, platform_commission_cents, transfer_reference from owner_payouts where booking_id = ${lit(bookingId)}`,
  );
  expect(payout, 'owner payout scheduled at return').toBeTruthy();
  expect(payout!.gross_rental_amount_cents).toBe(30000);
  expect(payout!.owner_amount_cents).toBe(24000); // owner 80%
  expect(payout!.platform_commission_cents).toBe(6000);

  // Before the delay: nothing is paid.
  await runCron(request, 'rental-pipeline');
  expect((await stubLog(request)).transfers.find((t) => t.reference === payout!.transfer_reference)).toBeUndefined();

  // The deposit goes back to the renter's card; the provider processes it.
  await runCron(request, 'rental-pipeline');
  await settleStubRefunds(request);
  expect(value<string>(`select state from refund_obligations where booking_group_id = ${lit(group)} and reason = 'deposit_settlement'`)).toBe('processed');

  // The 48-hour delay has passed (time moved on in the database).
  exec(`update owner_payouts set scheduled_at = now() - interval '1 hour' where booking_id = ${lit(bookingId)};
        update equipment_bookings set completed_at = now() - interval '49 hours', returned_at = now() - interval '49 hours' where id = ${lit(bookingId)};`);
  const r1 = await runCron(request, 'rental-pipeline');
  expect(r1.status).toBe(200);
  // Payouts are not auto-approved: a person approves it in Rental ops.
  const ops = await contextFor(browser, admin);
  await ops.page.goto('/admin/rental-ops');
  await ops.page.getByRole('tab', { name: /payouts/i }).or(ops.page.getByRole('button', { name: /^payouts/i })).first().click();
  ops.page.once('dialog', (d) => void d.accept());
  const approve = ops.page.getByRole('button', { name: /approve & send/i });
  await ops.page.locator('div').filter({ hasText: payout!.transfer_reference }).filter({ has: approve }).last().getByRole('button', { name: /approve & send/i }).click();
  await expect.poll(() => value<string>(`select state from owner_payouts where booking_id = ${lit(bookingId)}`), { timeout: 20_000 }).not.toBe('scheduled');
  await ops.context.close();
  await notifyStubTransfers(request);
  await runCron(request, 'rental-pipeline');
  const transfers = (await stubLog(request)).transfers.filter((t) => t.reference === payout!.transfer_reference);
  expect(transfers, JSON.stringify(r1.body)).toHaveLength(1);
  expect(Number(transfers[0].amount)).toBe(24000);
  expect(value<string>(`select state from owner_payouts where booking_id = ${lit(bookingId)}`)).toBe('success');
  expect(unbalancedJournals()).toEqual([]);
});
