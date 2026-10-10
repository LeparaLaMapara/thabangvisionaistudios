/**
 * Journey H: collection from the owner's address (Phase 8). LOCAL STACK ONLY
 * (see README.md). One order mixes studio gear with gear from two community
 * owners who opted in to "pickup from my address": our own vehicle runs one
 * leg per origin out, and one leg back to each origin. The geocoder is the
 * stub (every address verifies as Sandton), photos go to the stub Cloudinary.
 *
 * What a person would not do here: the owners' ID checks are marked verified
 * in the database (journey C proves the real ID approval), their listings are
 * seeded as published, and staff steps go through /api/admin/delivery (the
 * API the Delivery ops page calls).
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { exec, lit, one, rows, unbalancedJournals, value } from './helpers/db';
import { ANON_KEY, SUPABASE_URL, uniqueEmail } from './helpers/env';
import { accessToken, contextFor, makeAdmin, newAccount, type Account } from './helpers/auth';
import { seedStudioGear, ymd, type Gear } from './helpers/flows';
import { payOnStub, routeCheckoutToStub } from './helpers/pay';
import { PHOTO, routeCloudinaryToStub } from './helpers/storage';
import { addToCartAt, groupFrom, intentFor, readyRenter } from './helpers/rental';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const PHOTO_URL = 'https://res.cloudinary.com/journey-local/image/upload/v1/delivery/evidence.jpg';
const STREET_A = `7 Owner Lane ${run}`;
const STREET_B = `9 Owner Road ${run}`;
let admin: Account;
let renter: Account;
let ownerA: Account;
let ownerB: Account;
let studio: Gear;
let gearA: Gear;
let gearB: Gear;
let rCtx: BrowserContext;
let rp: Page;
let aCtx: BrowserContext;
let ap: Page;
let oaCtx: BrowserContext;
let oap: Page;
let obCtx: BrowserContext;
let obp: Page;
let group = '';

interface Leg { id: string; leg: string; status: string; origin_owner_id: string | null; customer_fee_cents: number; origin_address_id: string; destination_address_id: string; merchant_reference: string }
const legs = (): Leg[] =>
  rows<Leg>(`select id::text, leg, status, origin_owner_id::text, customer_fee_cents, origin_address_id::text, destination_address_id::text, merchant_reference
               from delivery_shipments where booking_group_id = ${lit(group)} order by leg desc, origin_owner_id nulls first`);
const legOf = (leg: 'outbound' | 'return', owner: Account | null): Leg => {
  const l = legs().find((x) => x.leg === leg && x.origin_owner_id === (owner ? owner.id : null));
  if (!l) throw new Error(`no ${leg} leg for ${owner ? owner.email : 'the studio'}`);
  return l;
};
const lineOf = (gear: Gear): string => value<string>(`select id::text from equipment_bookings where checkout_group_id = ${lit(group)} and rental_id = ${lit(gear.id)}`);

/** A published community listing of this owner (journey C proves the real listing flow). */
function seedCommunityGear(owner: Account, slug: string, title: string, replacementValue: number): Gear {
  exec(`
    insert into smart_rentals (slug, title, description, category, brand, model, price_per_day, deposit_amount,
      replacement_value, quantity, is_available, is_published, listing_status, owner_type, owner_id, thumbnail_url)
    values (${lit(slug)}, ${lit(title)}, 'Seeded owner gear for the pickup journey.', 'lighting-power',
      'Journey', 'Owner', 120, ${Math.round(replacementValue * 0.25)}, ${replacementValue}, 1, true, true, 'published', 'community', ${lit(owner.id)}, null)
    on conflict (slug) do nothing;
    insert into listing_private (rental_id) select id from smart_rentals where slug = ${lit(slug)} on conflict (rental_id) do nothing;`);
  const row = one<{ id: string }>(`select id::text from smart_rentals where slug = ${lit(slug)}`)!;
  return { id: row.id, slug, category: 'lighting-power', title };
}

test.beforeAll(async ({ browser }) => {
  studio = seedStudioGear({ slug: `journey-pickup-studio-${run}`, title: `Journey Pickup Studio Light ${run}`, pricePerDay: 150, replacementValue: 600, category: 'lighting-power' });
  admin = await newAccount(browser, uniqueEmail('admin-h'), 'rent');
  makeAdmin(admin);
  ownerA = await newAccount(browser, uniqueEmail('owner-ha'), 'list');
  ownerB = await newAccount(browser, uniqueEmail('owner-hb'), 'list');
  // Their ID checks were approved (journey C does this through the admin UI).
  exec(`update profiles set verification_status = 'verified', display_name = 'Journey Owner' where id in (${lit(ownerA.id)}, ${lit(ownerB.id)});`);
  gearA = seedCommunityGear(ownerA, `journey-pickup-a-${run}`, `Journey Owner A Light ${run}`, 700);
  gearB = seedCommunityGear(ownerB, `journey-pickup-b-${run}`, `Journey Owner B Mic ${run}`, 500);
  renter = await readyRenter(browser, admin, 'renter-h', '082 555 0808');
  // Not a first hire: one clean return a month ago (delivery opens after it).
  exec(`insert into equipment_bookings (user_id, rental_id, start_date, end_date, total_price, deposit_amount, status, quantity, completed_at)
        values (${lit(renter.id)}, ${lit(studio.id)}, now() - interval '35 days', now() - interval '33 days', 150, 100, 'completed', 1, now() - interval '33 days');`);
  ({ context: rCtx, page: rp } = await contextFor(browser, renter));
  await routeCheckoutToStub(rCtx);
  ({ context: aCtx, page: ap } = await contextFor(browser, admin));
  ({ context: oaCtx, page: oap } = await contextFor(browser, ownerA));
  await routeCloudinaryToStub(oaCtx);
  ({ context: obCtx, page: obp } = await contextFor(browser, ownerB));
});

test.afterAll(async () => {
  for (const c of [rCtx, aCtx, oaCtx, obCtx]) await c?.close();
});

const staff = async (data: Record<string, unknown>) => {
  const res = await ap.request.post('/api/admin/delivery', { data });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status(), body };
};

test('owner A saves a private pickup address and opts the listing in, on Listings', async () => {
  await oap.goto('/dashboard/listings');
  await expect(oap.getByRole('heading', { name: /pickups from your address/i })).toBeVisible({ timeout: 30_000 });
  await oap.getByLabel('Pickup street address').fill(STREET_A);
  await oap.getByLabel('Pickup suburb').fill('Melville');
  await oap.getByLabel('Pickup city').fill('Johannesburg');
  await oap.getByLabel('Pickup postal code').fill('2092');
  await oap.getByLabel('Driver asks for').fill('Ayanda');
  await oap.getByLabel('Phone for the driver').fill('082 555 0909');
  await oap.getByRole('button', { name: /save pickup address/i }).click();
  await expect(oap.getByTestId('owner-pickup-address')).toContainText(STREET_A);
  const box = oap.getByRole('checkbox', { name: new RegExp(`available for pickup from my address: ${gearA.title}`, 'i') });
  // A controlled switch: it shows on once the server saved it.
  await box.click();
  await expect(box).toBeChecked();
  await expect.poll(() => value<boolean>(`select owner_pickup from listing_private where rental_id = ${lit(gearA.id)}`)).toBe(true);
  const row = one<{ purpose: string; user_id: string; verified_by: string }>(`select purpose, user_id::text, verified_by from delivery_addresses where user_id = ${lit(ownerA.id)} and retired_at is null`)!;
  expect(row).toMatchObject({ purpose: 'owner_pickup', user_id: ownerA.id });
  expect(row.verified_by).not.toBe('');
});

test('owner B does the same through the API; an address outside the area is refused', async () => {
  const far = await obp.request.put('/api/delivery/owner-pickup', { data: { address: { street: '1 Long Street', suburb: 'City Centre', city: 'Cape Town', postalCode: '8001' }, contact_name: 'Bongani', contact_phone: '082 555 0910' } });
  expect(far.status()).toBe(422);
  const ok = await obp.request.put('/api/delivery/owner-pickup', { data: { address: { street: STREET_B, suburb: 'Parkhurst', city: 'Johannesburg', postalCode: '2193' }, contact_name: 'Bongani', contact_phone: '082 555 0910' } });
  expect(ok.status(), await ok.text()).toBe(200);
  // Only their own listing can be switched on.
  expect((await obp.request.patch('/api/delivery/owner-pickup', { data: { rental_id: gearA.id, enabled: false } })).status()).toBe(404);
  expect((await obp.request.patch('/api/delivery/owner-pickup', { data: { rental_id: gearB.id, enabled: true } })).status()).toBe(200);
});

test('the renter gets one delivery line per place the gear comes from, and the fee is in the charge', async () => {
  // R1 800 of gear in all: inside a newly trusted renter's limit.
  for (const g of [studio, gearA, gearB]) await addToCartAt(rp, g, ymd(10), ymd(12));
  await rp.goto('/dashboard/cart');
  await rp.getByRole('button', { name: /deliver to me/i }).click();
  await rp.getByLabel('Street address').fill('10 Rivonia Road');
  await rp.getByLabel('Suburb').fill('Sandton');
  await rp.getByLabel('City').fill('Johannesburg');
  await rp.getByLabel('Postal code').fill('2196');
  await rp.getByLabel('Who receives it').fill('Journey');
  await rp.getByLabel('Their phone').fill('082 555 0808');
  await rp.getByRole('checkbox', { name: /collect it from me/i }).check();
  await rp.getByRole('button', { name: /get (delivery|a new) quote/i }).click();
  const quote = rp.getByTestId('delivery-quote');
  await expect(quote).toBeVisible();
  await expect(quote.getByText(/delivery from the owner/i)).toHaveCount(2);
  await expect(quote.getByText(/return pickup back to the owner/i)).toHaveCount(2);
  await expect(quote).toContainText(/delivery from our studio/i);
  await expect(quote).toContainText(/delivery total/i);
  // The owners' streets never reach the renter's screen.
  await expect(quote).not.toContainText(STREET_A);
  await expect(quote).not.toContainText(STREET_B);

  const terms = rp.getByRole('checkbox', { name: /i agree to the terms/i });
  if (await terms.isVisible().catch(() => false)) await terms.check();
  await rp.getByRole('button', { name: /^checkout, r/i }).click();
  await payOnStub(rp);
  group = groupFrom(rp, 'checkout');
  await expect.poll(() => intentFor(group)?.state, { timeout: 20_000 }).toBe('paid');
  await expect.poll(() => legs().length, { timeout: 20_000 }).toBe(6);
  const all = legs();
  const intent = intentFor(group)!;
  expect(intent.delivery_cents).toBe(all.reduce((n, l) => n + l.customer_fee_cents, 0));
  // One outbound and one return leg per origin, each its own trip with its own reference.
  expect(all.map((l) => `${l.leg}:${l.origin_owner_id ?? 'studio'}`).sort()).toEqual(
    ['outbound:studio', `outbound:${ownerA.id}`, `outbound:${ownerB.id}`, 'return:studio', `return:${ownerA.id}`, `return:${ownerB.id}`].sort(),
  );
  expect(new Set(all.map((l) => l.merchant_reference)).size).toBe(6);
  expect(all.every((l) => l.status === 'scheduled')).toBe(true);
  // Owner A's legs start and end at owner A's own pickup address; the studio legs at the studio.
  const pickA = value<string>(`select id::text from delivery_addresses where user_id = ${lit(ownerA.id)} and purpose = 'owner_pickup' and retired_at is null`);
  expect(legOf('outbound', ownerA).origin_address_id).toBe(pickA);
  expect(legOf('return', ownerA).destination_address_id).toBe(pickA);
  expect(value<string>(`select purpose from delivery_addresses where id = ${lit(legOf('outbound', null).origin_address_id)}`)).toBe('platform_site');
  // The owners were told a collection is booked (their own lines only, nothing about the renter).
  for (const o of [ownerA, ownerB]) {
    const n = rows<{ data: Record<string, unknown> }>(`select data from notification_outbox where user_id = ${lit(o.id)} and kind = 'owner_pickup_scheduled' and channel = 'in_app'`);
    expect(n.map((x) => x.data.leg).sort()).toEqual(['outbound', 'return']);
  }
  expect(unbalancedJournals()).toEqual([]);
});

test('privacy: the renter sees the owner\'s suburb at most; owners see only their own; staff see the address only by an audited reveal', async ({ request }) => {
  const bookingA = lineOf(gearA);
  // Renter: the booking page API names the owner's area, never the street or phone.
  const status = await rp.request.get(`/api/delivery/status?booking_id=${bookingA}`);
  const st = (await status.json()) as { legs: { from: string; origin_area: string | null }[] };
  expect(st.legs.filter((l) => l.from === 'owner').length).toBe(4);
  const stText = JSON.stringify(st);
  for (const secret of [STREET_A, STREET_B, '0825550909', '0825550910', 'Ayanda', 'Bongani']) expect(stText).not.toContain(secret);
  // Renter, owner B and owner A straight at the database API (RLS): only their own address rows.
  const rest = async (who: Account) => {
    const token = await accessToken(request, who, ANON_KEY);
    const res = await request.get(`${SUPABASE_URL}/rest/v1/delivery_addresses?select=user_id,purpose,formatted_address`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } });
    return (await res.json()) as { user_id: string; purpose: string; formatted_address: string }[];
  };
  const asRenter = await rest(renter);
  expect(asRenter.every((r) => r.user_id === renter.id)).toBe(true);
  expect(JSON.stringify(asRenter)).not.toContain(STREET_A);
  const asB = await rest(ownerB);
  expect(asB.every((r) => r.user_id === ownerB.id)).toBe(true);
  expect(JSON.stringify(asB)).not.toContain(STREET_A);
  const asA = await rest(ownerA);
  expect(asA.map((r) => r.purpose)).toEqual(['owner_pickup']);
  // Owner A's view: their own item on their own legs; no renter, no fee, no other owner's gear.
  const mine = await oap.request.get('/api/delivery/owner-pickup');
  const mineText = await mine.text();
  expect(mine.status()).toBe(200);
  const m = JSON.parse(mineText) as { legs: { via: string; items: { rental_id: string }[] }[] };
  expect(m.legs.map((l) => l.via)).toEqual(['your_address', 'your_address']);
  expect(m.legs.flatMap((l) => l.items.map((i) => i.rental_id))).toEqual([gearA.id, gearA.id]);
  for (const secret of [renter.id, 'Rivonia', gearB.id, studio.id, 'customer_fee']) expect(mineText).not.toContain(secret);
  // Staff: the queues show the origin, never the address; the reveal is strict and logged.
  const q = await ap.request.get('/api/admin/delivery');
  const qText = await q.text();
  expect(qText).toContain(ownerA.id);
  expect(qText).not.toContain(STREET_A);
  const before = value<number>(`select count(*) from platform_events where event_type = 'delivery_ops_reveal_address'`);
  const reveal = await staff({ action: 'reveal_address', shipmentId: legOf('outbound', ownerA).id, side: 'origin' });
  expect(reveal.status).toBe(200);
  expect(JSON.stringify(reveal.body)).toContain(STREET_A);
  await expect.poll(() => value<number>(`select count(*) from platform_events where event_type = 'delivery_ops_reveal_address'`)).toBeGreaterThan(before);
});

test('outbound: each owner hands over at their door with a photo; our driver collects and delivers; the renter accepts; each fee earned once', async () => {
  // Owner A, on Listings, after our driver is assigned.
  const outA = legOf('outbound', ownerA);
  expect((await staff({ action: 'advance_manual', shipmentId: outA.id, state: 'courier_assigned' })).status).toBe(200);
  await oap.goto('/dashboard/listings');
  await oap.getByLabel(/photo of the item at handover/i).setInputFiles(PHOTO);
  await expect(oap.getByText('Photo added.')).toBeVisible();
  await oap.getByRole('button', { name: /handed to our driver/i }).click();
  await expect.poll(() => value<number>(`select count(*) from delivery_custody_events where shipment_id = ${lit(outA.id)} and kind = 'handed_to_courier' and actor_kind = 'owner'`)).toBe(1);
  // Owner B (API): their own item only; owner A's item is refused.
  const outB = legOf('outbound', ownerB);
  expect((await obp.request.post('/api/delivery/owner-handover', { data: { shipment_id: outA.id, booking_id: lineOf(gearA), rental_id: gearA.id, action: 'handed_over', photos: [PHOTO_URL] } })).status()).toBe(404);
  expect((await obp.request.post('/api/delivery/owner-handover', { data: { shipment_id: outB.id, booking_id: lineOf(gearB), rental_id: gearB.id, action: 'handed_over', photos: [] } })).status()).toBe(400);
  expect((await obp.request.post('/api/delivery/owner-handover', { data: { shipment_id: outB.id, booking_id: lineOf(gearB), rental_id: gearB.id, action: 'handed_over', photos: [PHOTO_URL] } })).status()).toBe(200);

  for (const [owner, gear] of [[null, studio], [ownerA, gearA], [ownerB, gearB]] as const) {
    const l = legOf('outbound', owner);
    if (owner !== ownerA) expect((await staff({ action: 'advance_manual', shipmentId: l.id, state: 'courier_assigned' })).status).toBe(200);
    const c = await staff({ action: 'record_collection', shipmentId: l.id, bookingId: lineOf(gear), rentalId: gear.id, photos: [PHOTO_URL], serialConfirmed: true, condition: 'Good' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const d = await staff({ action: 'record_handover', shipmentId: l.id, bookingId: lineOf(gear), rentalId: gear.id, photos: [PHOTO_URL], outcome: 'delivered' });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
  }
  expect(value<number>(`select count(*) from notification_outbox where user_id = ${lit(ownerA.id)} and kind = 'owner_pickup_collected'`)).toBeGreaterThan(0);

  // The renter accepts every item on the booking page.
  await rp.goto(`/dashboard/bookings/${lineOf(studio)}`);
  const received = rp.getByRole('button', { name: /^received$/i });
  for (let i = 0; i < 3; i++) {
    // Wait for the panel to show what is still to confirm before the next press.
    await expect(received).toHaveCount(3 - i);
    await received.first().click();
    await expect.poll(() => value<number>(`select count(*) from delivery_custody_events c join delivery_shipments s on s.id = c.shipment_id where s.booking_group_id = ${lit(group)} and c.kind = 'renter_accepted'`)).toBe(i + 1);
  }
  const keys = rows<{ k: string }>(`select idempotency_key as k from ledger_journals where idempotency_key like ${lit(`delivery:${group}:outbound%`)} order by 1`).map((r) => r.k);
  expect(keys).toEqual([`delivery:${group}:outbound`, `delivery:${group}:outbound@${ownerA.id}`, `delivery:${group}:outbound@${ownerB.id}`].sort());
  const income = value<number>(`select coalesce(sum(l.credit_cents - l.debit_cents), 0) from ledger_lines l join ledger_journals j on j.id = l.journal_id where j.idempotency_key like ${lit(`delivery:${group}:outbound%`)} and l.account = 'delivery_income'`);
  expect(Number(income)).toBe(legs().filter((l) => l.leg === 'outbound').reduce((n, l) => n + l.customer_fee_cents, 0));
  expect(unbalancedJournals()).toEqual([]);
});

test('return: gear goes back to each owner, who confirms receipt and condition (or reports a problem); studio gear is inspected by staff', async () => {
  for (const [owner, gear] of [[ownerA, gearA], [ownerB, gearB], [null, studio]] as const) {
    const l = legOf('return', owner);
    expect((await staff({ action: 'advance_manual', shipmentId: l.id, state: 'courier_assigned' })).status).toBe(200);
    const c = await staff({ action: 'record_collection', shipmentId: l.id, bookingId: lineOf(gear), rentalId: gear.id, photos: [PHOTO_URL], serialConfirmed: true, condition: 'Good' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    if (owner) expect((await staff({ action: 'advance_manual', shipmentId: l.id, state: 'courier_at_dropoff' })).status).toBe(200);
  }
  // The owner is told the gear is back and asked to confirm.
  expect(value<number>(`select count(*) from notification_outbox where user_id = ${lit(ownerA.id)} and kind = 'owner_gear_returned'`)).toBeGreaterThan(0);

  // Owner A confirms on Listings: receipt and condition.
  const retA = legOf('return', ownerA);
  await oap.goto('/dashboard/listings');
  await oap.getByLabel(/photo of the item as it came back/i).setInputFiles(PHOTO);
  await expect(oap.getByText('Photo added.')).toBeVisible();
  await oap.getByLabel(/condition it came back in/i).fill('Good, all accessories there');
  await oap.getByRole('button', { name: /received back/i }).click();
  await expect
    .poll(() => rows<{ kind: string; actor_kind: string }>(`select kind, actor_kind from delivery_custody_events where shipment_id = ${lit(retA.id)} order by id`).map((r) => `${r.kind}:${r.actor_kind}`))
    .toEqual(['collected_by_courier:thabangvision_staff', 'received_by_owner:owner', 'inspected:owner']);
  expect(value<string>(`select status from delivery_shipments where id = ${lit(retA.id)}`)).toBe('delivered');
  expect(value<number>(`select count(*) from ledger_journals where idempotency_key = ${lit(`delivery:${group}:return@${ownerA.id}`)}`)).toBe(1);

  // Owner B reports a problem: an incident (nobody accused) that holds only their line.
  const retB = legOf('return', ownerB);
  const r = await obp.request.post('/api/delivery/owner-handover', { data: { shipment_id: retB.id, booking_id: lineOf(gearB), rental_id: gearB.id, action: 'problem', photos: [PHOTO_URL], problem_kind: 'damaged', description: 'Cracked windshield on the mic' } });
  expect(r.status(), await r.text()).toBe(200);
  const inc = one<{ booking_ids: string[]; liability: string; status: string; reported_by_kind: string }>(`select booking_ids::text[] as booking_ids, liability, status, reported_by_kind from delivery_incidents where shipment_id = ${lit(retB.id)}`)!;
  expect(inc).toMatchObject({ booking_ids: [lineOf(gearB)], liability: 'undetermined', status: 'open', reported_by_kind: 'owner' });
  // Owner A cannot confirm owner B's return.
  expect((await oap.request.post('/api/delivery/owner-handover', { data: { shipment_id: retB.id, booking_id: lineOf(gearB), rental_id: gearB.id, action: 'received', photos: [PHOTO_URL], condition: 'Fine' } })).status()).toBe(404);

  // Studio gear back to the studio: received and inspected by staff, as before.
  const retS = legOf('return', null);
  expect((await staff({ action: 'record_handover', shipmentId: retS.id, bookingId: lineOf(studio), rentalId: studio.id, photos: [PHOTO_URL], outcome: 'received', serialConfirmed: true })).status).toBe(200);
  expect((await staff({ action: 'record_inspection', shipmentId: retS.id, bookingId: lineOf(studio), rentalId: studio.id, photos: [PHOTO_URL], serialConfirmed: true, condition: 'Good' })).status).toBeLessThan(300);

  // Ledger: every delivery journal for the order balances; each leg earned once.
  const dupes = rows(`select idempotency_key, count(*) from ledger_journals where idempotency_key like ${lit(`delivery:${group}:%`)} group by 1 having count(*) > 1`);
  expect(dupes).toEqual([]);
  expect(unbalancedJournals()).toEqual([]);
});
