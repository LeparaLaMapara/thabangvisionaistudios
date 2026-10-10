/**
 * Journey G: Ubunye with no AI provider reachable. LOCAL STACK ONLY.
 * Answer quality is NOT tested here (no model locally).
 */
import { test, expect } from '@playwright/test';
import { clearRateLimit } from './helpers/db';
import { expectNoStackTrace } from './helpers/env';

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  messages: [{ id: `m-${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] }],
  ...extra,
});

// The daily ceiling per network address (STUDIO.ai.guestNetworkDailyMessages):
// every run of these journeys comes from 127.0.0.1, so several runs in one
// day pass it. A person on their own address would not.
test.beforeAll(() => clearRateLimit('ai-guest-day:'));

test('the chat fails gracefully: a plain message, no stack trace', async ({ page }) => {
  await page.goto('/ubunye-ai-studio');
  const box = page.getByRole('textbox').first();
  await box.fill('What cameras can I rent this weekend?');
  await box.press('Enter');
  await expect(page.getByText(/couldn.t get a reply through|ubunye is unavailable right now/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  // A reply that never came does not use up one of the guest's free messages.
  await expect(page.getByText(/5 free messages left/i)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('ubunye_msg_count'))).toBeNull();
  await expectNoStackTrace(page);
});

test('the API answers with a readable error event, never a stack', async ({ request }) => {
  const res = await request.post('/api/ubunye-chat', { data: message('Hello') });
  expect(res.status()).toBeLessThan(500);
  const body = await res.text();
  expect(body).toMatch(/unavailable/i);
  expect(body).not.toMatch(/at \S+ \(|node_modules|stack/i);
});

test('guest limits apply: the browser allowance and the per-minute ceiling', async ({ request }) => {
  // A guest who has used their allowance (5) is refused before any model call.
  const over = await request.post('/api/ubunye-chat', { data: message('One more?', { sessionMessageCount: 5 }) });
  expect(over.status()).toBe(429);
  expect(await over.json()).toMatchObject({ error: 'limit_reached', plan: 'guest', limit: 5 });
  // The per-minute ceiling per network address (10).
  clearRateLimit('ai-guest:');
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await request.post('/api/ubunye-chat', { data: message(`hi ${i}`) })).status());
  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
  expect(statuses.slice(10)).toEqual([429, 429]);
  clearRateLimit('ai-guest:');
});

test('a guest cannot use the booking agent', async ({ request }) => {
  const res = await request.post('/api/ubunye-chat', { data: message('Book a photographer', { creator_id: '00000000-0000-4000-8000-000000000000' }) });
  expect(res.status()).toBe(401);
});
