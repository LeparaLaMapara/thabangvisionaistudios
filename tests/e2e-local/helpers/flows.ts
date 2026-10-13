/**
 * LOCAL STACK ONLY: multi-step setups shared by the journeys.
 */
import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { exec, lit, one, value } from './db';
import { APP_LOG } from './env';
import type { Account } from './auth';

/** Confirm a phone number through /api/phone/send + /verify, reading the code from the server log. */
export async function verifyPhone(request: APIRequestContext, phone: string): Promise<void> {
  expect(APP_LOG, 'APP_LOG must point at the app server log').toBeTruthy();
  const before = readFileSync(APP_LOG, 'utf8').length;
  const send = await request.post('/api/phone/send', { data: { phone } });
  expect(send.status(), await send.text()).toBe(200);
  let code = '';
  for (let i = 0; i < 40 && !code; i++) {
    const m = readFileSync(APP_LOG, 'utf8').slice(before).match(/\[sms:log\] to \+27\d\d\*+: (\d{6}) /);
    if (m) code = m[1];
    else await new Promise((r) => setTimeout(r, 250));
  }
  expect(code).toMatch(/^\d{6}$/);
  const ok = await request.post('/api/phone/verify', { data: { code } });
  expect(ok.status(), await ok.text()).toBe(200);
}

/**
 * Stand-in for the ID upload: the local stack has no Storage service, so the
 * documents cannot be uploaded. Record the submission the way the server does
 * after a successful upload (submit_verification_for_user), with paths only.
 */
export function submitIdWithoutUpload(account: Account, displayName: string): void {
  exec(`
    update profiles set display_name = ${lit(displayName)} where id = ${lit(account.id)};
    select submit_verification_for_user(${lit(account.id)}::uuid,
      ${lit(`${account.id}/id-front.jpg`)}, ${lit(`${account.id}/selfie.jpg`)});`);
  expect(value<string>(`select verification_status from profiles where id = ${lit(account.id)}`)).toBe('pending');
}

/** An admin approves a pending ID check in /admin/verifications. */
export async function approveIdInAdmin(adminPage: Page, displayName: string, userId: string): Promise<void> {
  await adminPage.goto('/admin/verifications');
  const row = adminPage.getByRole('button', { name: new RegExp(displayName, 'i') }).first();
  await row.click();
  await adminPage.getByRole('button', { name: /^approve$/i }).first().click();
  await expect
    .poll(() => value<string>(`select verification_status from profiles where id = ${lit(userId)}`), { timeout: 15_000 })
    .toBe('verified');
}

/** A YYYY-MM-DD date `days` from today (local). */
export function ymd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface Gear {
  id: string;
  slug: string;
  category: string;
  title: string;
}

/** Studio-owned gear, published (the founder adds studio gear in admin; seeded here). */
export function seedStudioGear(opts: {
  slug: string;
  title: string;
  pricePerDay: number;
  replacementValue: number;
  quantity?: number;
  category?: string;
}): Gear {
  const category = opts.category ?? 'cameras-optics';
  exec(`
    insert into smart_rentals (slug, title, description, category, brand, model, price_per_day, deposit_amount,
      replacement_value, quantity, is_available, is_published, owner_type, thumbnail_url)
    values (${lit(opts.slug)}, ${lit(opts.title)}, 'Seeded for the local journey tests.', ${lit(category)},
      'Journey', 'Local', ${opts.pricePerDay}, ${Math.round(opts.replacementValue * 0.25)},
      ${opts.replacementValue}, ${opts.quantity ?? 2}, true, true, 'studio', null)
    on conflict (slug) do nothing;`);
  const row = one<{ id: string }>(`select id::text from smart_rentals where slug = ${lit(opts.slug)}`);
  return { id: row!.id, slug: opts.slug, category, title: opts.title };
}

/** The legal name an ID check would carry (set before the ID is sent, as the profile form does). */
export function setLegalName(account: Account, first: string, last: string): void {
  exec(`update profiles set first_name = ${lit(first)}, last_name = ${lit(last)}, display_name = ${lit(`${first} ${last}`)}
         where id = ${lit(account.id)};`);
}

/** Save a payout bank account through /api/banking (validated against the stub bank). */
export async function addValidatedBank(request: APIRequestContext, holder: string): Promise<void> {
  const res = await request.post('/api/banking', {
    data: {
      bank_name: 'Test Bank', bank_code: '632005', account_number: '62000000001', account_type: 'cheque',
      account_holder: holder, id_number: '9001015009087',
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
}
