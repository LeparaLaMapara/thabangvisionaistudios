/**
 * Journey E: delivery in our own vehicle. LOCAL STACK ONLY (see README.md).
 * The geocoder is the stub (Sandton for any address, Cape Town when asked,
 * nothing for "nowhere"). Staff steps go through /api/admin/delivery, the
 * API the Delivery ops page calls, with an admin session.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { clearRateLimit, exec, lit, one, rows, unbalancedJournals, value } from './helpers/db';
import { refundsFor, runCron, settleStubRefunds, stubTx, uniqueEmail } from './helpers/env';
import { contextFor, makeAdmin, newAccount, type Account } from './helpers/auth';
import { seedStudioGear, ymd, type Gear } from './helpers/flows';
import { payOnStub, routeCheckoutToStub } from './helpers/pay';
import { addToCartAt, groupFrom, intentFor, readyRenter } from './helpers/rental';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const PHOTO_URL = 'https://res.cloudinary.com/journey-local/image/upload/v1/delivery/evidence.jpg';
let admin: Account;
let renter: Account;
let gear: Gear;
let gear2: Gear;
let rCtx: BrowserContext;
let rp: Page;
let aCtx: BrowserContext;
let ap: Page;

interface Shipment { id: string; leg: string; status: string; customer_fee_cents: number; items: unknown }
const shipments = (group: string): Shipment[] =>
  rows<Shipment>(`select id::text, leg, status, customer_fee_cents, items from delivery_shipments where booking_group_id = ${lit(group)} order by leg desc, created_at`);

test.beforeAll(async ({ browser }) => {
  gear = seedStudioGear({ slug: `journey-deliver-${run}`, title: `Journey Delivered Light ${run}`, pricePerDay: 180, replacementValue: 1200, category: 'lighting-power' });
  gear2 = seedStudioGear({ slug: `journey-deliver2-${run}`, title: `Journey Delivered Mic ${run}`, pricePerDay: 90, replacementValue: 600, category: 'audio' });
  admin = await newAccount(browser, uniqueEmail('admin-e'), 'rent');
  makeAdmin(admin);
  renter = await readyRenter(browser, admin, 'renter-e', '082 555 0505');
  // Not a first hire: one clean return a month ago (delivery opens after it).
  exec(`insert into equipment_bookings (user_id, rental_id, start_date, end_date, total_price, deposit_amount, status, quantity, completed_at)
        values (${lit(renter.id)}, ${lit(gear2.id)}, now() - interval '35 days', now() - interval '33 days', 180, 150, 'completed', 1, now() - interval '33 days');`);
  ({ context: rCtx, page: rp } = await contextFor(browser, renter));
  await routeCheckoutToStub(rCtx);
  ({ context: aCtx, page: ap } = await contextFor(browser, admin));
});

test.afterAll(async () => {
  await rCtx?.close();
  await aCtx?.close();
});

async function chooseDelivery(page: Page, street: string, city: string, opts: { withReturn?: boolean } = {}): Promise<void> {
  await page.goto('/dashboard/cart');
  await page.getByRole('button', { name: /deliver to me/i }).click();
  await page.getByLabel('Street address').fill(street);
  await page.getByLabel('Suburb').fill(city === 'Cape Town' ? 'City Centre' : 'Sandton');
  await page.getByLabel('City').fill(city);
  await page.getByLabel('Postal code').fill(city === 'Cape Town' ? '8001' : '2196');
  await page.getByLabel('Who receives it').fill('Journey');
  await page.getByLabel('Their phone').fill('082 555 0505');
  if (opts.withReturn) await page.getByRole('checkbox', { name: /pick it up|return/i }).check();
  await page.getByRole('button', { name: /get (delivery|a new) quote/i }).click();
}

test('delivery address: Cape Town is outside the area, "nowhere" is not found, Sandton is quoted', async () => {
  await addToCartAt(rp, gear, ymd(10), ymd(12));
  await chooseDelivery(rp, '1 Long Street', 'Cape Town');
  // Outside the service area: delivery is switched off for this order, collection stays.
  await expect(rp.getByText(/we deliver in gauteng only/i).first()).toBeVisible();
  await expect(rp.getByRole('button', { name: /deliver to me/i })).toBeDisabled();
  await chooseDelivery(rp, '1 Nowhere Lane', 'Nowhere');
  await expect(rp.getByRole('alert').filter({ hasText: /find|found|check the address|could not/i }).first()).toBeVisible();
  await chooseDelivery(rp, '10 Rivonia Road', 'Johannesburg');
  await expect(rp.getByTestId('delivery-quote')).toBeVisible();
  await expect(rp.getByTestId('delivery-quote')).toContainText(/sandton|rivonia/i);
});

let group = '';
let bookingId = '';
test('pay with delivery: the fee is part of the charge in cents, and the leg is prepared', async () => {
  const terms = rp.getByRole('checkbox', { name: /i agree to the terms/i });
  if (await terms.isVisible().catch(() => false)) await terms.check();
  const pay = rp.getByRole('button', { name: /^checkout, r/i });
  await expect(pay).toBeEnabled();
  await pay.click();
  const reference = await payOnStub(rp);
  group = groupFrom(rp, 'checkout');
  await expect.poll(() => intentFor(group)?.state, { timeout: 20_000 }).toBe('paid');
  const intent = intentFor(group)!;
  expect(intent.delivery_cents).toBeGreaterThan(0);
  expect(intent.hire_cents + intent.deposit_cents + intent.delivery_cents).toBe((await stubTx(rp.request, reference))!.amount);
  const legs = shipments(group);
  expect(legs.map((s) => s.leg)).toContain('outbound');
  expect(legs.find((s) => s.leg === 'outbound')!.customer_fee_cents).toBe(intent.delivery_cents);
  bookingId = value<string>(`select id::text from equipment_bookings where checkout_group_id = ${lit(group)} limit 1`);
  expect(unbalancedJournals()).toEqual([]);
});

test('the shipment appears in /admin/delivery-ops', async () => {
  const outbound = shipments(group).find((s) => s.leg === 'outbound')!;
  const res = await ap.request.get('/api/admin/delivery');
  expect(res.status()).toBe(200);
  expect(JSON.stringify(await res.json())).toContain(outbound.id);
  await ap.goto('/admin/delivery-ops');
  await expect(ap.getByRole('heading', { name: /delivery ops/i })).toBeVisible();
  // The leg is in one of the queues (tabs), shown by its merchant reference.
  const ref = value<string>(`select merchant_reference from delivery_shipments where id = ${lit(outbound.id)}`);
  let found = false;
  for (const tab of await ap.getByRole('tab').all()) {
    await tab.click();
    if (await ap.getByText(ref).first().isVisible().catch(() => false)) { found = true; break; }
  }
  expect(found, `shipment ${ref} listed in a Delivery ops queue`).toBe(true);
});

const staff = async (data: Record<string, unknown>) => {
  // No rate-limit reset: recording a delivery's progress counts against the
  // everyday admin limit (30 a minute), and money and courier bookings
  // against the strict one (5), so a whole delivery runs at test speed.
  const res = await ap.request.post('/api/admin/delivery', { data });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status(), body };
};

test('staff dispatch and hand over with evidence; the renter accepts each item; the fee is earned once', async () => {
  const outbound = shipments(group).find((s) => s.leg === 'outbound')!;
  if (outbound.status === 'prepared') expect((await staff({ action: 'dispatch', shipmentId: outbound.id })).status).toBe(200);
  for (const state of ['courier_assigned', 'in_transit', 'courier_at_dropoff']) {
    const r = await staff({ action: 'advance_manual', shipmentId: outbound.id, state });
    expect([200, 409], JSON.stringify(r.body)).toContain(r.status);
  }
  const noPhoto = await staff({ action: 'record_handover', shipmentId: outbound.id, bookingId, rentalId: gear.id, photos: [], outcome: 'delivered' });
  expect(noPhoto.status).toBeGreaterThanOrEqual(400);
  const handover = await staff({ action: 'record_handover', shipmentId: outbound.id, bookingId, rentalId: gear.id, photos: [PHOTO_URL], outcome: 'delivered', serialConfirmed: true, condition: 'Good' });
  expect(handover.status, JSON.stringify(handover.body)).toBe(200);
  // Staff can never accept for the renter.
  expect((await staff({ action: 'record_handover', shipmentId: outbound.id, bookingId, rentalId: gear.id, photos: [PHOTO_URL], outcome: 'accepted' })).status).toBe(400);

  const earned = () => value<number>(`select count(*) from ledger_journals where idempotency_key = ${lit(`delivery:${group}:outbound`)}`);
  expect(earned()).toBe(0);
  await rp.goto(`/dashboard/bookings/${bookingId}`);
  await rp.getByRole('button', { name: /^received$/i }).first().click();
  await expect.poll(earned, { timeout: 15_000 }).toBe(1);
  // Accepting again (another tab) changes nothing.
  const again = await rp.request.post('/api/delivery/accept', { data: { booking_id: bookingId, items: [{ booking_id: bookingId, rental_id: gear.id, outcome: 'accepted' }] } });
  expect(again.status()).toBeLessThan(500);
  expect(earned()).toBe(1);
  expect(unbalancedJournals()).toEqual([]);
});

test('return pickup: the renter asks for it on the booking; staff record it paid, collect and receive', async () => {
  await rp.goto(`/dashboard/bookings/${bookingId}`);
  await rp.getByRole('button', { name: /get pickup price/i }).click();
  const request = rp.getByRole('button', { name: /request pickup at r/i });
  await expect(request).toBeVisible();
  await request.click();
  // Recorded once on its quote, waiting for staff to take the payment by hand.
  const best = await (async () => {
    await expect.poll(() => value<number>(`select count(*) from delivery_quotes where leg = 'return' and renter_id = ${lit(renter.id)}`), { timeout: 15_000 }).toBeGreaterThan(0);
    return one<{ id: string; customer_fee_cents: number }>(
      `select id::text, customer_fee_cents from delivery_quotes where leg = 'return' and renter_id = ${lit(renter.id)} order by created_at desc limit 1`,
    );
  })();
  expect(best).toBeTruthy();
  // Staff take the payment by hand and dispatch the leg.
  const paid = await staff({ action: 'dispatch_manual_paid', bookingGroupId: group, quoteIds: [best!.id], method: 'eft', reference: `RET-${run}`, receivedCents: best!.customer_fee_cents });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  const ret = shipments(group).find((s) => s.leg === 'return');
  expect(ret, 'return leg booked').toBeTruthy();
  for (const state of ['courier_assigned', 'courier_at_pickup']) await staff({ action: 'advance_manual', shipmentId: ret!.id, state });
  const collected = await staff({ action: 'record_collection', shipmentId: ret!.id, bookingId, rentalId: gear.id, photos: [PHOTO_URL], serialConfirmed: true, condition: 'Good' });
  expect(collected.status, JSON.stringify(collected.body)).toBe(200);
  await staff({ action: 'advance_manual', shipmentId: ret!.id, state: 'in_transit' });
  const received = await staff({ action: 'record_handover', shipmentId: ret!.id, bookingId, rentalId: gear.id, photos: [PHOTO_URL], outcome: 'received', serialConfirmed: true });
  expect(received.status, JSON.stringify(received.body)).toBe(200);
  const inspected = await staff({ action: 'record_inspection', shipmentId: ret!.id, bookingId, rentalId: gear.id, photos: [PHOTO_URL], serialConfirmed: true, condition: 'Good' });
  expect(inspected.status, JSON.stringify(inspected.body)).toBeLessThan(300);
  expect(value<number>(`select count(*) from ledger_journals where idempotency_key like ${lit(`delivery:${group}:%`)}`)).toBeGreaterThanOrEqual(1);
  expect(unbalancedJournals()).toEqual([]);
});

async function deliveryOrder(start: number, end: number): Promise<{ group: string; reference: string; bookingId: string }> {
  await addToCartAt(rp, gear, ymd(start), ymd(end));
  await chooseDelivery(rp, '10 Rivonia Road', 'Johannesburg');
  await expect(rp.getByTestId('delivery-quote')).toBeVisible();
  const terms = rp.getByRole('checkbox', { name: /i agree to the terms/i });
  if (await terms.isVisible().catch(() => false)) await terms.check();
  await rp.getByRole('button', { name: /^checkout, r/i }).click();
  const reference = await payOnStub(rp);
  const g = groupFrom(rp, 'checkout');
  await expect.poll(() => intentFor(g)?.state, { timeout: 20_000 }).toBe('paid');
  return { group: g, reference, bookingId: value<string>(`select id::text from equipment_bookings where checkout_group_id = ${lit(g)} limit 1`) };
}

test('renter cancels before dispatch: the delivery fee is refunded exactly once', async ({ request }) => {
  clearRateLimit(`checkout:${renter.id}`); // 3 checkouts a minute per renter
  const o = await deliveryOrder(20, 21);
  const fee = intentFor(o.group)!.delivery_cents;
  rp.once('dialog', (d) => void d.accept());
  await rp.goto(`/dashboard/bookings/${o.bookingId}`);
  await rp.getByRole('button', { name: /cancel booking/i }).click();
  await expect.poll(() => value<string>(`select status from equipment_bookings where id = ${lit(o.bookingId)}`), { timeout: 15_000 }).toBe('cancelled');
  await runCron(request, 'rental-pipeline');
  await runCron(request, 'rental-pipeline');
  const charged = (await stubTx(request, o.reference))!.amount;
  const refunds = await refundsFor(request, o.reference);
  const total = refunds.reduce((n, r) => n + r.amount, 0);
  expect(total).toBeLessThanOrEqual(charged);
  // The fee is its own refund (per leg), keyed so it can only happen once.
  const feeObligations = rows<{ amount_cents: number }>(`select amount_cents from refund_obligations where booking_group_id = ${lit(o.group)} and obligation_key like '%delivery-%'`);
  expect(feeObligations, 'one delivery-fee refund').toHaveLength(1);
  expect(feeObligations[0].amount_cents).toBe(fee);
  expect(refunds.filter((r) => r.amount === fee)).toHaveLength(1);
  expect(unbalancedJournals()).toEqual([]);
});

test('staff cancel after delivery with the refund box: one refund, return pickup kept, staff alerted', async ({ request }) => {
  clearRateLimit(`checkout:${renter.id}`);
  const o = await deliveryOrder(24, 26);
  const outbound = shipments(o.group).find((s) => s.leg === 'outbound')!;
  if (outbound.status === 'prepared') await staff({ action: 'dispatch', shipmentId: outbound.id });
  for (const state of ['courier_assigned', 'in_transit', 'courier_at_dropoff']) await staff({ action: 'advance_manual', shipmentId: outbound.id, state });
  expect((await staff({ action: 'record_handover', shipmentId: outbound.id, bookingId: o.bookingId, rentalId: gear.id, photos: [PHOTO_URL], outcome: 'delivered', serialConfirmed: true })).status).toBe(200);
  // Staff cancel the hire in admin bookings with "refund" ticked, after the gear was delivered.
  const alertsBefore = value<number>(`select count(*) from notification_outbox where kind ilike '%staff%' or kind ilike '%alert%'`);
  const cancel = await ap.request.patch(`/api/admin/equipment-bookings/${o.bookingId}`, { data: { status: 'cancelled', refundCents: 0, refundDeliveryFee: true, reason: 'Journey test: staff cancel after delivery' } });
  expect(cancel.status(), await cancel.text()).toBeLessThan(300);
  await runCron(request, 'rental-pipeline');
  await runCron(request, 'rental-pipeline');
  await settleStubRefunds(request);
  const refunds = await refundsFor(request, o.reference);
  expect(refunds, 'exactly one refund: the delivery fee').toHaveLength(1);
  expect(refunds[0].amount).toBe(intentFor(o.group)!.delivery_cents);
  // The gear is still with the renter: a return pickup stays available/booked, and staff are told.
  const ret = rows<{ status: string }>(`select status from delivery_shipments where booking_group_id = ${lit(o.group)} and leg = 'return' and status <> 'cancelled'`);
  const offer = await rp.request.get(`/api/delivery/status?booking_id=${o.bookingId}`);
  const status = JSON.stringify(await offer.json());
  expect(ret.length > 0 || /return/i.test(status), status).toBe(true);
  expect(value<number>(`select count(*) from notification_outbox where kind ilike '%staff%' or kind ilike '%alert%'`)).toBeGreaterThan(alertsBefore);
  expect(unbalancedJournals()).toEqual([]);
});

test('ledger: delivery fee earned exactly once per order', () => {
  const dupes = rows(`select idempotency_key, count(*) from ledger_journals where idempotency_key like 'delivery:%' group by 1 having count(*) > 1`);
  expect(dupes).toEqual([]);
  expect(one(`select 1 as x`)).toBeTruthy();
});
