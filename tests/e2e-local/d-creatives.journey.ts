/**
 * Journey D: a creator onboards, is verified, is booked and paid for, delivers,
 * and is paid out after the acceptance delay. LOCAL STACK ONLY (see README.md).
 * AI (portfolio tagging, bio writer) is unreachable here: onboarding must
 * still be possible by hand.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { exec, lit, one, value } from './helpers/db';
import { ANON_KEY, SUPABASE_URL, notifyStubTransfers, runCron, stubLog, stubTx, uniqueEmail } from './helpers/env';
import { contextFor, makeAdmin, newAccount, type Account } from './helpers/auth';
import { addValidatedBank, approveIdInAdmin, setLegalName, submitIdWithoutUpload, verifyPhone } from './helpers/flows';
import { payOnStub, routeCheckoutToStub } from './helpers/pay';
import { PHOTO, routeCloudinaryToStub } from './helpers/storage';

test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
const projectTitle = `Journey Wedding Story ${run}`;
let admin: Account;
let creator: Account;
let client: Account;
let creatorCtx: BrowserContext;
let cp: Page;
let clientCtx: BrowserContext;
let kp: Page;

test.beforeAll(async ({ browser }) => {
  admin = await newAccount(browser, uniqueEmail('admin-d'), 'rent');
  makeAdmin(admin);
  client = await newAccount(browser, uniqueEmail('client-d'), 'hire');
  ({ context: clientCtx, page: kp } = await contextFor(browser, client));
  await routeCheckoutToStub(clientCtx);
});

test.afterAll(async () => {
  await creatorCtx?.close();
  await clientCtx?.close();
});

const bookingBody = () => ({
  creator_id: creator.id,
  booking_type: 'production',
  project_category: 'Wedding photography',
  project_description: 'Ceremony and reception coverage, about 200 edited photos.',
  duration_hours: 2,
  location: 'Sandton, Johannesburg',
  preferred_dates: '2026-12-12',
});

test('creator onboarding without AI: photos, skills chosen by hand, bio typed', async ({ browser }) => {
  creator = await newAccount(browser, uniqueEmail('creator-d'), 'supply');
  ({ context: creatorCtx, page: cp } = await contextFor(browser, creator));
  await routeCloudinaryToStub(creatorCtx);
  await cp.goto('/onboarding');
  await cp.locator('input[type="file"]').first().setInputFiles([PHOTO, { ...PHOTO, name: 'second.png' }]);
  // The portfolio AI cannot read the photos here: the creator carries on.
  await cp.getByRole('button', { name: /continue and choose my skills/i }).click({ timeout: 60_000 });
  await expect(cp.getByText(/choose what you do/i)).toBeVisible({ timeout: 30_000 });
  await cp.getByRole('button', { name: /^photography$/i }).click();
  await cp.getByRole('button', { name: /confirm skills/i }).click();
  // Bio: the writer is unreachable; the creator types it.
  const bio = cp.locator('textarea').first();
  await expect(bio).toBeEditable({ timeout: 60_000 });
  await bio.fill('Johannesburg wedding and portrait photographer. Natural light, honest moments, quick turnaround.');
  await cp.getByRole('button', { name: /looks good/i }).click();
  await cp.getByRole('button', { name: /skip for now/i }).click();
  await cp.waitForURL(/\/dashboard\/verification/, { timeout: 30_000 });
  const p = one<{ specializations: string[]; skills: string[]; crew_bio: string; onboarding_completed_at: string | null; available_for_hire: boolean | null }>(
    `select specializations, skills, crew_bio, onboarding_completed_at, available_for_hire from profiles where id = ${lit(creator.id)}`,
  )!;
  expect(p.specializations).toContain('photography');
  expect(p.skills).toContain('Photography');
  expect(p.crew_bio).toMatch(/wedding and portrait/);
  expect(p.onboarding_completed_at).toBeTruthy();
});

test('portfolio stays private until the creator is verified', async ({ request }) => {
  const put = await cp.request.put('/api/portfolio', {
    data: { projects: [{ id: `p-${run}`, title: projectTitle, project_type: 'photography', description: 'A wedding in the Magaliesberg.', photos: [{ url: 'https://res.cloudinary.com/journey-local/image/upload/v1/p/a.jpg', public_id: 'p/a' }] }] },
  });
  expect(put.status(), await put.text()).toBeLessThan(300);
  const anon = await request.get(`${SUPABASE_URL}/rest/v1/public_profiles?id=eq.${creator.id}&select=portfolio_projects,crew_bio,verification_status`, { headers: { apikey: ANON_KEY } });
  const [row] = (await anon.json()) as Array<{ portfolio_projects: unknown; crew_bio: string }>;
  expect(row.portfolio_projects).toBeNull();
  const page = await (await request.get(`/creators/${creator.id}`)).text();
  expect(page).not.toContain(projectTitle);
});

test('an unverified creator cannot be booked', async () => {
  const res = await kp.request.post('/api/service-bookings', { data: bookingBody() });
  expect(res.status()).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe('creator_not_bookable');
  expect(value<number>(`select count(*) from bookings where creator_id = ${lit(creator.id)}`)).toBe(0);
});

test('admin verifies the creator: portfolio public, creator bookable, payout account validated', async ({ browser, request }) => {
  await verifyPhone(cp.request, '082 555 0404');
  setLegalName(creator, 'Cebo', `Creator${run}`);
  submitIdWithoutUpload(creator, `Cebo Creator${run}`);
  const a = await contextFor(browser, admin);
  await approveIdInAdmin(a.page, `Cebo Creator${run}`, creator.id);
  await a.context.close();
  await addValidatedBank(cp.request, `Cebo Creator${run}`);
  const anon = await request.get(`${SUPABASE_URL}/rest/v1/public_profiles?id=eq.${creator.id}&select=portfolio_projects,available_for_hire`, { headers: { apikey: ANON_KEY } });
  const [row] = (await anon.json()) as Array<{ portfolio_projects: Array<{ title: string }> | null; available_for_hire: boolean }>;
  expect(row.portfolio_projects?.[0]?.title).toBe(projectTitle);
  expect(row.available_for_hire).toBe(true);
  const page = await (await request.get(`/creators/${creator.id}`)).text();
  expect(page).toContain(projectTitle);
});

let bookingId = '';
let reference = '';
test('client books the creator through /api/service-bookings and pays', async () => {
  const res = await kp.request.post('/api/service-bookings', { data: bookingBody() });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const body = (await res.json()) as { booking: { id: string; reference: string; total: number }; payment_url?: string; paymentUrl?: string };
  bookingId = body.booking.id;
  reference = body.booking.reference;
  const url = body.payment_url ?? body.paymentUrl;
  expect(url, JSON.stringify(body)).toMatch(/^https:\/\/checkout\.paystack\.com\//);
  await kp.goto(url!);
  await payOnStub(kp);
  await expect(kp).toHaveURL(/status=success/);
  const b = one<{ status: string; payment_status: string; total: number; creator_amount: number; platform_amount: number }>(
    `select status, payment_status, total::float as total, creator_amount::float as creator_amount, platform_amount::float as platform_amount from bookings where id = ${lit(bookingId)}`,
  )!;
  expect(b.payment_status).toBe('paid');
  expect(b.status).toBe('paid');
  const tx = (await stubTx(kp.request, reference))!;
  expect(tx.amount).toBe(Math.round(b.total * 100));
  expect(Math.round((b.creator_amount + b.platform_amount) * 100)).toBeLessThanOrEqual(Math.round(b.total * 100));
});

test('creator accepts and delivers; client approves; payout waits 72 hours, then goes out once', async ({ request }) => {
  const accept = await cp.request.patch(`/api/service-bookings/${bookingId}/status`, { data: { action: 'accept' } });
  expect(accept.status(), await accept.text()).toBe(200);
  const deliver = await cp.request.patch(`/api/service-bookings/${bookingId}/deliver`, { data: { delivery_url: 'https://example.com/gallery/journey', delivery_message: 'Your photos are ready.' } });
  expect(deliver.status(), await deliver.text()).toBe(200);
  // The client sees every option the delivery allows, not only Approve, and who their creator is.
  await kp.goto('/dashboard/bookings');
  await expect(kp.getByRole('button', { name: /approve the work/i })).toBeVisible();
  await expect(kp.getByRole('button', { name: /ask for changes \(1 left\)/i })).toBeVisible();
  await expect(kp.getByRole('button', { name: /report a problem/i })).toBeVisible();
  await expect(kp.getByText(new RegExp(`creator: cebo creator${run}`, "i")).first()).toBeVisible();
  await expect(kp.getByText(/ask for changes or report a problem/i).first()).toBeVisible();
  // Only the client can approve.
  const wrong = await cp.request.patch(`/api/service-bookings/${bookingId}/status`, { data: { action: 'approve_delivery' } });
  expect(wrong.status()).toBeGreaterThanOrEqual(400);
  const approve = await kp.request.patch(`/api/service-bookings/${bookingId}/status`, { data: { action: 'approve_delivery' } });
  expect(approve.status(), await approve.text()).toBe(200);
  const due = value<string>(`select payout_due_at from bookings where id = ${lit(bookingId)}`);
  const hours = (new Date(due).getTime() - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(71);
  expect(hours).toBeLessThanOrEqual(72.1);

  const creatorAmountCents = Math.round(value<number>(`select creator_amount::float from bookings where id = ${lit(bookingId)}`) * 100);
  // The payout's stable transfer reference (lib/core/services/payouts.ts).
  const transferRef = `tvsp_${bookingId.replace(/-/g, '')}`;
  const sent = async () => (await stubLog(request)).transfers.filter((t) => t.reference === transferRef);
  expect((await runCron(request, 'daily-maintenance')).status).toBe(200);
  expect(await sent()).toHaveLength(0);

  // 72 hours later (moved on in the database).
  exec(`update bookings set payout_due_at = now() - interval '1 minute', completed_at = now() - interval '73 hours' where id = ${lit(bookingId)};`);
  const r = await runCron(request, 'daily-maintenance');
  expect(r.status).toBe(200);
  await notifyStubTransfers(request);
  await runCron(request, 'daily-maintenance');
  const ref = value<string>(`select payout_reference from bookings where id = ${lit(bookingId)}`);
  expect(ref, JSON.stringify(r.body)).toBe(transferRef);
  const transfers = await sent();
  expect(transfers).toHaveLength(1);
  expect(Number(transfers[0].amount)).toBe(creatorAmountCents);
  expect(value<string>(`select payout_status from bookings where id = ${lit(bookingId)}`)).toMatch(/paid|completed|success/);
});
