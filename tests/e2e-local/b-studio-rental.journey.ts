/**
 * Journey B: renting studio gear end to end. LOCAL STACK ONLY (see README.md).
 * Money is checked in the database and in the stub's own log, not the UI.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { exec, lit, one, rows, unbalancedJournals, value } from './helpers/db';
import { PAYSTACK_SECRET, refundsFor, runCron, stubTx, uniqueEmail } from './helpers/env';
import { contextFor, makeAdmin, newAccount, type Account } from './helpers/auth';
import { approveIdInAdmin, seedStudioGear, submitIdWithoutUpload, verifyPhone, ymd, type Gear } from './helpers/flows';
import { cancelOnStub, payOnStub, routeCheckoutToStub } from './helpers/pay';
import { checkoutFromCart } from './helpers/rental';
import { createHmac } from 'node:crypto';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
let renter: Account;
let admin: Account;
let gear: Gear;
let bigGear: Gear;
let renterCtx: BrowserContext;
let rp: Page;

interface Intent {
  checkout_group_id: string;
  reference: string;
  state: string;
  expected_amount_cents: number;
  hire_cents: number;
  deposit_cents: number;
  provider_transaction_id: string | null;
}
const intentFor = (group: string): Intent | undefined =>
  one<Intent>(`select checkout_group_id::text, reference, state, expected_amount_cents, hire_cents, deposit_cents, provider_transaction_id
                 from rental_payment_intents where checkout_group_id = ${lit(group)}`);
const lineStatuses = (group: string): string[] =>
  rows<{ status: string }>(`select status from equipment_bookings where checkout_group_id = ${lit(group)} order by id`).map((r) => r.status);
const groupFromUrl = (page: Page, param: string): string => new URL(page.url()).searchParams.get(param) ?? '';

test.beforeAll(async ({ browser }) => {
  gear = seedStudioGear({ slug: `journey-cam-${run}`, title: `Journey Cam ${run}`, pricePerDay: 200, replacementValue: 1500 });
  bigGear = seedStudioGear({ slug: `journey-cine-${run}`, title: `Journey Cine ${run}`, pricePerDay: 2500, replacementValue: 60000, quantity: 1 });
  renter = await newAccount(browser, uniqueEmail('renter-b'), 'rent');
  admin = await newAccount(browser, uniqueEmail('admin-b'), 'rent');
  makeAdmin(admin);
  ({ context: renterCtx, page: rp } = await contextFor(browser, renter));
  await routeCheckoutToStub(renterCtx);
});

test.afterAll(async () => {
  await renterCtx?.close();
});

test('browse /rentals and open the gear page', async () => {
  await rp.goto('/rentals');
  await rp.getByRole('link', { name: /cameras & optics/i }).first().click();
  await expect(rp).toHaveURL(new RegExp(`/rentals/${gear.category}`));
  await rp.getByRole('link', { name: `View details: ${gear.title}` }).click();
  await expect(rp).toHaveURL(new RegExp(`/rentals/${gear.category}/${gear.slug}`));
  await expect(rp.getByRole('heading', { name: gear.title })).toBeVisible();
});

test('eligibility lists what is missing before the first hire', async () => {
  const res = await rp.request.get(`/api/rentals/eligibility?rental_id=${gear.id}&quantity=1&start=${ymd(7)}&end=${ymd(9)}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; missing: Array<{ code: string }> };
  expect(body.ok).toBe(false);
  const codes = body.missing.map((m) => m.code);
  expect(codes).toContain('verify_phone');
  expect(codes).toContain('verify_id');
});

test('renter confirms phone, sends ID; admin approves in /admin/verifications', async ({ browser }) => {
  await verifyPhone(rp.request, '082 555 0202');
  submitIdWithoutUpload(renter, `Journey Renter ${run}`);
  const { context, page } = await contextFor(browser, admin);
  await approveIdInAdmin(page, `Journey Renter ${run}`, renter.id);
  await context.close();
  const res = await rp.request.get(`/api/rentals/eligibility?rental_id=${gear.id}&quantity=1&start=${ymd(7)}&end=${ymd(9)}`);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test('first hire must be collected: delivery is refused by eligibility', async () => {
  const res = await rp.request.get(`/api/rentals/eligibility?rental_id=${gear.id}&quantity=1&start=${ymd(7)}&end=${ymd(9)}&delivery=1`);
  const body = (await res.json()) as Record<string, unknown>;
  expect(JSON.stringify(body)).toMatch(/collect/i);
});

test('choose dates, add to cart, edit dates', async () => {
  await rp.goto(`/rentals/${gear.category}/${gear.slug}?start=${ymd(7)}&end=${ymd(9)}`);
  await rp.getByRole('button', { name: /add to cart and keep browsing/i }).click();
  await expect(rp.getByRole('link', { name: /added/i })).toBeVisible();
  let item = one<{ start_date: string; end_date: string }>(
    `select start_date::date::text as start_date, end_date::date::text as end_date from cart_items where user_id = ${lit(renter.id)} and rental_id = ${lit(gear.id)}`,
  );
  expect(item).toEqual({ start_date: ymd(7), end_date: ymd(9) });
  // "Edit dates" in the cart goes back to the gear page with the dates; posting new ones updates the line.
  await rp.goto('/dashboard/cart');
  await rp.getByRole('link', { name: new RegExp(`edit dates for ${gear.title}`, 'i') }).click();
  await expect(rp).toHaveURL(new RegExp(`start=${ymd(7)}`));
  await rp.goto(`/rentals/${gear.category}/${gear.slug}?start=${ymd(8)}&end=${ymd(11)}`);
  await rp.getByRole('button', { name: /add to cart and keep browsing/i }).click();
  await expect(rp.getByRole('link', { name: /added/i })).toBeVisible();
  item = one(`select start_date::date::text as start_date, end_date::date::text as end_date from cart_items where user_id = ${lit(renter.id)} and rental_id = ${lit(gear.id)}`);
  expect(item).toEqual({ start_date: ymd(8), end_date: ymd(11) });
  expect(value<number>(`select count(*) from cart_items where user_id = ${lit(renter.id)}`)).toBe(1);
});

let cancelledGroup = '';
test('cancel on the payment page: back to the cart, hold released, nothing charged, items kept', async () => {
  await checkoutFromCart(rp);
  const reference = await cancelOnStub(rp);
  expect(rp.url()).toContain('/dashboard/cart?payment=cancelled');
  cancelledGroup = groupFromUrl(rp, 'order');
  await expect(rp.getByText(/nothing was charged/i)).toBeVisible();
  await expect(rp.getByText(gear.title).first()).toBeVisible();
  const intent = intentFor(cancelledGroup)!;
  expect(intent.reference).toBe(reference);
  expect(intent.state).not.toBe('paid');
  // Released: the hold ends now (the line stays 'pending' until the pipeline expires it), so the dates are free.
  expect(value<number>(`select count(*) from equipment_bookings where checkout_group_id = ${lit(cancelledGroup)}
                          and (status = 'cancelled' or (status = 'pending' and hold_expires_at <= now()))`)).toBe(lineStatuses(cancelledGroup).length);
  expect(value<boolean>(`select hold_expires_at <= now() from rental_payment_intents where checkout_group_id = ${lit(cancelledGroup)}`)).toBe(true);
  expect(value<number>(`select count(*) from cart_items where user_id = ${lit(renter.id)}`)).toBe(1);
  expect((await stubTx(rp.request, reference))?.status).not.toBe('success');
  expect(await refundsFor(rp.request, reference)).toHaveLength(0);
  // Consent for the order was recorded at checkout.
  expect(value<number>(`select count(*) from consent_records where user_id = ${lit(renter.id)} and source = 'checkout' and consent_purpose = 'rental_agreement'`)).toBeGreaterThan(0);
});

let paidGroup = '';
let paidReference = '';
test('checkout and pay: intent paid, cents match the charge, ledger balanced, notices queued', async () => {
  await rp.waitForTimeout(1000);
  await checkoutFromCart(rp);
  paidReference = await payOnStub(rp);
  expect(rp.url()).toContain('/dashboard/bookings?checkout=');
  paidGroup = groupFromUrl(rp, 'checkout');
  await expect.poll(() => intentFor(paidGroup)?.state, { timeout: 20_000 }).toBe('paid');
  const intent = intentFor(paidGroup)!;
  const tx = (await stubTx(rp.request, paidReference))!;
  expect(tx.status).toBe('success');
  expect(intent.expected_amount_cents).toBe(tx.amount);
  expect(intent.hire_cents + intent.deposit_cents).toBe(tx.amount);
  // 3 days at R200 = R600 hire; deposit 25% of R1,500 = R375.
  expect(intent.hire_cents).toBe(60000);
  expect(intent.deposit_cents).toBe(37500);
  expect(lineStatuses(paidGroup)).toEqual(['confirmed']);
  expect(value<number>(`select count(*) from ledger_journals where booking_group_id = ${lit(paidGroup)}`)).toBeGreaterThan(0);
  expect(unbalancedJournals()).toEqual([]);
  const cash = value<number>(`select coalesce(sum(debit_cents) - sum(credit_cents), 0) from ledger_lines l join ledger_journals j on j.id = l.journal_id
                                where j.booking_group_id = ${lit(paidGroup)} and l.account = 'cash_at_provider'`);
  expect(Number(cash)).toBe(tx.amount);
  expect(value<number>(`select count(*) from notification_outbox where user_id = ${lit(renter.id)}`)).toBeGreaterThan(0);
  expect(value<number>(`select count(*) from cart_items where user_id = ${lit(renter.id)}`)).toBe(0);
});

test('a replayed webhook has no second effect', async ({ request }) => {
  const journals = value<number>(`select count(*) from ledger_journals where booking_group_id = ${lit(paidGroup)}`);
  const outbox = value<number>(`select count(*) from notification_outbox where user_id = ${lit(renter.id)}`);
  const tx = (await stubTx(request, paidReference))!;
  const body = JSON.stringify({
    event: 'charge.success',
    data: { id: tx.id, reference: tx.reference, amount: tx.amount, currency: 'ZAR', status: 'success', paid_at: new Date().toISOString(), channel: 'card', metadata: tx.metadata, customer: { email: renter.email } },
  });
  const sig = createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
  for (let i = 0; i < 2; i++) {
    const res = await request.post('/api/webhooks/paystack', { headers: { 'content-type': 'application/json', 'x-paystack-signature': sig }, data: body });
    expect(res.status()).toBe(200);
  }
  const bad = await request.post('/api/webhooks/paystack', { headers: { 'content-type': 'application/json', 'x-paystack-signature': 'bad' }, data: body });
  expect(bad.status()).toBe(401);
  expect(value<number>(`select count(*) from ledger_journals where booking_group_id = ${lit(paidGroup)}`)).toBe(journals);
  expect(value<number>(`select count(*) from notification_outbox where user_id = ${lit(renter.id)}`)).toBe(outbox);
  expect(intentFor(paidGroup)?.state).toBe('paid');
  expect(unbalancedJournals()).toEqual([]);
});

test('the booking page shows what was paid and what happens next', async () => {
  const bookingId = value<string>(`select id::text from equipment_bookings where checkout_group_id = ${lit(paidGroup)} limit 1`);
  await rp.goto(`/dashboard/bookings/${bookingId}`);
  // From the payment intent: R600 hire + R375 deposit, never "No payments".
  await expect(rp.getByRole('heading', { name: /payments and refunds/i })).toBeVisible();
  await expect(rp.getByText(/^Paid on /)).toBeVisible();
  await expect(rp.getByText('R975', { exact: true })).toBeVisible();
  await expect(rp.getByText(/no payments/i)).toHaveCount(0);
  // What happens next: where and when to collect, what to bring.
  await expect(rp.getByRole('heading', { name: /^collect on /i })).toBeVisible();
  await expect(rp.getByText(/bring the ID you verified with/i).first()).toBeVisible();
  // The list names the item, in the same status words.
  await rp.goto('/dashboard/bookings');
  await rp.getByRole('button', { name: /equipment rentals/i }).or(rp.getByRole('tab', { name: /equipment rentals/i })).first().click();
  await expect(rp.getByRole('heading', { name: gear.title }).first()).toBeVisible();
  await expect(rp.getByText('confirmed', { exact: true }).first()).toBeVisible();
});

let skipGroup = '';
test('paid without a webhook: the return trip still confirms the payment', async () => {
  await rp.goto(`/rentals/${gear.category}/${gear.slug}?start=${ymd(15)}&end=${ymd(16)}`);
  await rp.getByRole('button', { name: /add to cart and keep browsing/i }).click();
  await expect(rp.getByRole('link', { name: /added/i })).toBeVisible();
  await rp.waitForTimeout(1000);
  await checkoutFromCart(rp);
  const reference = await payOnStub(rp, { skipWebhook: true });
  skipGroup = groupFromUrl(rp, 'checkout');
  expect((await stubTx(rp.request, reference))?.status).toBe('success');
  // The renter is back on the bookings page; the payment is confirmed from the callback.
  await expect.poll(() => intentFor(skipGroup)?.state, { timeout: 20_000 }).toBe('paid');
  expect(lineStatuses(skipGroup)).toEqual(['confirmed']);
  expect(unbalancedJournals()).toEqual([]);
});

test('renter cancels a paid booking: exactly one refund, never more than charged', async ({ request }) => {
  const bookingId = value<string>(`select id::text from equipment_bookings where checkout_group_id = ${lit(skipGroup)} limit 1`);
  const reference = intentFor(skipGroup)!.reference;
  const charged = (await stubTx(request, reference))!.amount;
  rp.once('dialog', (d) => void d.accept());
  await rp.goto(`/dashboard/bookings/${bookingId}`);
  await rp.getByRole('button', { name: /cancel booking/i }).click();
  await expect.poll(() => lineStatuses(skipGroup)[0], { timeout: 15_000 }).toBe('cancelled');
  // The renter is told what happened to the money, and sees the refund with its status.
  await expect(rp.getByRole('status').filter({ hasText: /your booking is cancelled/i })).toBeVisible();
  await expect(rp.getByText(/cancellation refund/i)).toBeVisible();
  // The refund goes out now or on the next pipeline pass.
  if ((await refundsFor(request, reference)).length === 0) {
    const r = await runCron(request, 'rental-pipeline');
    expect(r.status).toBe(200);
  }
  // A second pipeline pass and a second cancel do not refund again.
  await runCron(request, 'rental-pipeline');
  const again = await rp.request.put(`/api/bookings/${bookingId}`, { data: { status: 'cancelled' } });
  expect(again.status()).toBe(409);
  const refunds = await refundsFor(request, reference);
  expect(refunds).toHaveLength(1);
  expect(refunds[0].amount).toBeLessThanOrEqual(charged);
  const obligations = value<number>(`select coalesce(sum(amount_cents), 0) from refund_obligations where booking_group_id = ${lit(skipGroup)}`);
  expect(Number(obligations)).toBeLessThanOrEqual(charged);
  expect(Number(obligations)).toBe(refunds[0].amount);
  expect(unbalancedJournals()).toEqual([]);
});

test('a renter reports a problem from the booking page, and it reaches the team', async () => {
  // A finished hire of this renter's (seeded: the counter steps are journey C's).
  exec(`insert into equipment_bookings (user_id, rental_id, start_date, end_date, total_price, deposit_amount, status, quantity, completed_at)
        values (${lit(renter.id)}, ${lit(gear.id)}, now() - interval '10 days', now() - interval '8 days', 400, 375, 'completed', 1, now() - interval '7 days');`);
  const bookingId = value<string>(`select id::text from equipment_bookings where user_id = ${lit(renter.id)} and status = 'completed' order by created_at desc limit 1`);
  await rp.goto(`/dashboard/bookings/${bookingId}`);
  await rp.getByRole('button', { name: /report a problem/i }).first().click();
  const dialog = rp.getByRole('dialog', { name: /report a problem/i });
  await dialog.getByRole('radio', { name: /broken, damaged or missing/i }).check();
  await dialog.getByRole('textbox').fill('The lens cap and one battery were missing from the bag.');
  await dialog.getByRole('button', { name: /send to our team/i }).click();
  await expect(rp.getByText(/we have your report/i)).toBeVisible();
  const d = one<{ dispute_type: string; status: string; reason: string }>(
    `select dispute_type, status, reason from disputes where equipment_booking_id = ${lit(bookingId)}`,
  );
  expect(d).toMatchObject({ dispute_type: 'gear_damage', status: 'open' });
  // A second report on the same booking is pointed to the open one.
  await expect(rp.getByRole('button', { name: /report a problem/i })).toHaveCount(0);
});

test('over R50,000 is always collected, even for a trusted renter', async ({ browser }) => {
  // A renter with a long clean history (seeded: five clean returns over R50k, 100+ days ago).
  const vet = await newAccount(browser, uniqueEmail('veteran-b'), 'rent');
  exec(`
    update profiles set phone_verified_at = now(), verification_status = 'verified' where id = ${lit(vet.id)};
    insert into banking_details (user_id, bank_name, bank_code, account_type, account_holder, account_last4, is_verified)
      values (${lit(vet.id)}, 'Test Bank', '632005', 'cheque', 'Journey Veteran', '0001', true) on conflict (user_id) do update set is_verified = true;
    insert into equipment_bookings (user_id, rental_id, start_date, end_date, total_price, deposit_amount, status, quantity, completed_at)
    select ${lit(vet.id)}, ${lit(bigGear.id)}, now() - interval '130 days' + (g || ' days')::interval, now() - interval '128 days' + (g || ' days')::interval,
           5000, 15000, 'completed', 1, now() - interval '120 days' + (g || ' days')::interval
      from generate_series(1, 5) g;`);
  const { context, page } = await contextFor(browser, vet);
  const q = `rental_id=${bigGear.id}&quantity=1&start=${ymd(20)}&end=${ymd(22)}`;
  const collect = (await (await page.request.get(`/api/rentals/eligibility?${q}`)).json()) as Record<string, unknown>;
  const deliver = (await (await page.request.get(`/api/rentals/eligibility?${q}&delivery=1`)).json()) as Record<string, unknown>;
  expect(collect.ok, JSON.stringify(collect)).toBe(true);
  expect(deliver.ok, JSON.stringify(deliver)).toBe(false);
  expect(JSON.stringify(deliver)).toMatch(/collected in person/i);
  // Ordinary gear may be delivered for this renter.
  const small = (await (await page.request.get(`/api/rentals/eligibility?rental_id=${gear.id}&quantity=1&start=${ymd(20)}&end=${ymd(22)}&delivery=1`)).json()) as Record<string, unknown>;
  expect(small.ok, JSON.stringify(small)).toBe(true);
  await context.close();
});
