/**
 * LOCAL STACK ONLY: where the journey specs find the local services.
 * Everything defaults to the ports `supabase start` and the harness stub use.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
export const STUB = process.env.STUB_URL ?? 'http://localhost:4010';
export const APP = process.env.BASE_URL ?? 'http://localhost:3000';
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const CRON_SECRET = process.env.CRON_SECRET ?? '';
export const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? '';
/** Server log of the running app (phone codes are printed there with SMS_PROVIDER=log). */
export const APP_LOG = process.env.APP_LOG ?? '';

/** A unique, recognisable address per run. */
export function uniqueEmail(role: string): string {
  return `${role}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@journey.test`;
}

// ── Mailpit ────────────────────────────────────────────────────────────────

interface MailSummary { ID: string; Subject: string; Created: string; To: Array<{ Address: string }> }

export async function latestMail(
  request: APIRequestContext,
  to: string,
  opts: { after?: Date; subject?: RegExp; timeoutMs?: number } = {},
): Promise<{ id: string; subject: string; text: string; html: string }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`);
    const body = (await res.json()) as { messages: MailSummary[] };
    const hit = body.messages
      .filter((m) => !opts.after || new Date(m.Created).getTime() >= opts.after.getTime() - 1000)
      .filter((m) => !opts.subject || opts.subject.test(m.Subject))
      .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime())[0];
    if (hit) {
      const full = (await (await request.get(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as {
        Text: string; HTML: string; Subject: string;
      };
      return { id: hit.ID, subject: full.Subject, text: full.Text, html: full.HTML };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} arrived in Mailpit`);
}

export function codeFrom(text: string): string {
  const m = text.match(/\b(\d{6,10})\b/);
  if (!m) throw new Error('No code in email');
  return m[1];
}

export function linkFrom(html: string, contains: string): string {
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const hit = links.find((l) => l.includes(contains));
  if (!hit) throw new Error(`No link containing ${contains} in email`);
  return hit;
}

// ── Stub Paystack ───────────────────────────────────────────────────────────

export interface StubTx { id: number; reference: string; amount: number; status: string; metadata: Record<string, unknown> }
export interface StubRefund { id: number; amount: number; transaction: { id: number; reference: string } }
export interface StubTransfer { id: number; reference: string; amount: number; recipient: string; status: string }
export interface StubLog {
  log: Array<Record<string, unknown>>;
  tx: StubTx[];
  refunds: StubRefund[];
  transfers: StubTransfer[];
}

export async function stubLog(request: APIRequestContext): Promise<StubLog> {
  return (await (await request.get(`${STUB}/__log`)).json()) as StubLog;
}

export async function stubTx(request: APIRequestContext, reference: string): Promise<StubTx | undefined> {
  return (await stubLog(request)).tx.find((t) => t.reference === reference);
}

export async function refundsFor(request: APIRequestContext, reference: string): Promise<StubRefund[]> {
  return (await stubLog(request)).refunds.filter((r) => r.transaction.reference === reference);
}

// ── Cron ────────────────────────────────────────────────────────────────────

export async function runCron(request: APIRequestContext, route: string): Promise<{ status: number; body: unknown }> {
  const res = await request.get(`${APP}/api/cron/${route}`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    timeout: 120_000,
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

// ── Pages ───────────────────────────────────────────────────────────────────

/** The body never shows a stack trace or a raw framework error. */
export async function expectNoStackTrace(page: Page): Promise<void> {
  const text = (await page.textContent('body')) ?? '';
  expect(text).not.toMatch(/at \S+ \(\/|node_modules|TypeError:|ReferenceError:|Unhandled Runtime Error/);
}

/** Provider side: process every pending refund and send its refund.processed webhook. */
export async function settleStubRefunds(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${STUB}/__refunds/settle`);
  expect(res.ok()).toBe(true);
}

/** Provider side: send transfer.* webhooks for transfers not yet reported. */
export async function notifyStubTransfers(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${STUB}/__transfers/notify`);
  expect(res.ok()).toBe(true);
}
