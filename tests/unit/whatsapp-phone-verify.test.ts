/**
 * Phone checks by inbound WhatsApp message (Meta Cloud API):
 * lib/whatsapp/meta.ts, lib/phone-verify and /api/webhooks/whatsapp.
 */
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PendingCode, PhoneVerifyStore } from '@/lib/phone-verify';

// ─── In-memory store and rate limiter behind the route ─────────────────────

class MemoryStore implements PhoneVerifyStore {
  codes = new Map<string, PendingCode>(); // by user id, like phone_codes
  profiles = new Map<string, { phone: string; phone_verified_at: string }>();
  markCalls = 0;
  async pendingForPhone(phone: string, nowIso: string): Promise<PendingCode[]> {
    return [...this.codes.values()].filter((c) => c.phone === phone && c.expiresAt > nowIso);
  }
  async markVerified(userId: string, phone: string, atIso: string): Promise<void> {
    this.markCalls += 1;
    this.profiles.set(userId, { phone, phone_verified_at: atIso });
  }
  async consume(userId: string, codeHash: string): Promise<boolean> {
    const c = this.codes.get(userId);
    if (!c || c.codeHash !== codeHash) return false;
    this.codes.delete(userId);
    return true;
  }
}

const state = vi.hoisted(() => ({ store: null as unknown, hits: new Map<string, number>(), events: [] as unknown[] }));

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));
vi.mock('@/lib/data/events', () => ({ logEvent: (e: unknown) => state.events.push(e) }));
vi.mock('@/lib/auth', () => ({
  checkRateLimit: async (key: string, max: number) => {
    const n = (state.hits.get(key) ?? 0) + 1;
    state.hits.set(key, n);
    return n <= max;
  },
}));
vi.mock('@/lib/phone-verify', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/phone-verify')>();
  return { ...actual, supabasePhoneVerifyStore: () => state.store };
});

const { GET, POST } = await import('@/app/api/webhooks/whatsapp/route');
const { verifyMetaSignature, metaChallenge, parseMetaInbound } = await import('@/lib/whatsapp/meta');
const PV = await import('@/lib/phone-verify');
const { hashCode, codesMatch } = await import('@/lib/sms/phone');

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';
const CODE_SECRET = 'test-code-secret';
const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ENTERED = '+27821234567';
const WA_SENDER = '27821234567';

const sign = (raw: string, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

function payload(from: string, body: string, id = 'wamid.ONE'): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '27600000000', phone_number_id: '123' },
          contacts: [{ profile: { name: 'Test' }, wa_id: from }],
          messages: [{ from, id, timestamp: '1760000000', type: 'text', text: { body } }],
        },
      }],
    }],
  });
}

function post(raw: string, signature: string | null): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['X-Hub-Signature-256'] = signature;
  return new NextRequest('http://localhost:3000/api/webhooks/whatsapp', { method: 'POST', body: raw, headers });
}

function seed(store: MemoryStore, opts: { user?: string; phone?: string; digits?: string; expiresInMs?: number } = {}): void {
  const user = opts.user ?? USER;
  store.codes.set(user, {
    userId: user,
    phone: opts.phone ?? ENTERED,
    codeHash: PV.whatsappCodeHash(opts.digits ?? '482913', user, CODE_SECRET),
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 600_000)).toISOString(),
  });
}

const ENV_KEYS = ['WHATSAPP_PROVIDER', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_NUMBER', 'PHONE_CODE_SECRET'];
let saved: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  process.env.WHATSAPP_BUSINESS_NUMBER = '+27600000000';
  process.env.PHONE_CODE_SECRET = CODE_SECRET;
  delete process.env.WHATSAPP_PROVIDER;
  state.store = new MemoryStore();
  state.hits.clear();
  state.events.length = 0;
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' }] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

// ─── Signature ─────────────────────────────────────────────────────────────

describe('X-Hub-Signature-256', () => {
  const raw = payload(WA_SENDER, 'hello');
  it('accepts the HMAC-SHA256 of the raw body under the app secret', () => {
    expect(verifyMetaSignature(raw, sign(raw), APP_SECRET)).toBe(true);
  });
  it('refuses a wrong secret, a changed body, a bad format and an empty secret', () => {
    expect(verifyMetaSignature(raw, sign(raw, 'other-secret'), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(`${raw} `, sign(raw), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, sign(raw).replace('sha256=', 'sha1='), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, 'sha256=abc', APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, sign(raw, ''), '')).toBe(false);
  });
  it('refuses a missing header', () => {
    expect(verifyMetaSignature(raw, null, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, '', APP_SECRET)).toBe(false);
  });
  it('the route rejects unsigned and wrongly signed posts with 401 and stores nothing', async () => {
    const store = state.store as MemoryStore;
    seed(store);
    const body = payload(WA_SENDER, 'Verify my ThabangVision number: TV-482913');
    expect((await POST(post(body, null))).status).toBe(401);
    expect((await POST(post(body, sign(body, 'wrong')))).status).toBe(401);
    expect(store.profiles.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('the route refuses with 503 when the app secret is not set (meta chosen explicitly)', async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    process.env.WHATSAPP_PROVIDER = 'meta';
    const body = payload(WA_SENDER, 'TV-482913');
    expect((await POST(post(body, sign(body)))).status).toBe(503);
  });
});

// ─── Handshake ─────────────────────────────────────────────────────────────

describe('webhook handshake (GET)', () => {
  const get = (q: string) => GET(new NextRequest(`http://localhost:3000/api/webhooks/whatsapp?${q}`));
  it('echoes hub.challenge when the verify token matches', async () => {
    const res = await get(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
  });
  it('refuses a wrong token, a wrong mode, or no token configured', async () => {
    expect((await get('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status).toBe(403);
    expect((await get(`hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`)).status).toBe(403);
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    expect((await get('hub.mode=subscribe&hub.verify_token=&hub.challenge=1')).status).toBe(403);
  });
  it('never reflects markup', () => {
    const p = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '<script>' });
    expect(metaChallenge(p, VERIFY_TOKEN)).toBeNull();
  });
});

// ─── Parsing and codes ─────────────────────────────────────────────────────

describe('codes and payloads', () => {
  it('formats and extracts TV codes', () => {
    expect(PV.formatWhatsappCode('482913')).toBe('TV-482913');
    expect(PV.extractWhatsappCode('Verify my ThabangVision number: TV-482913')).toBe('482913');
    expect(PV.extractWhatsappCode('tv 482913')).toBe('482913');
    expect(PV.extractWhatsappCode('TV482913 thanks')).toBe('482913');
    expect(PV.extractWhatsappCode('TV-4829131')).toBeNull();
    expect(PV.extractWhatsappCode('ATV-482913')).toBeNull();
    expect(PV.extractWhatsappCode('482913')).toBeNull();
    expect(PV.extractWhatsappCode('hello')).toBeNull();
  });
  it('builds the wa.me link with the prefilled message', () => {
    const { text, link } = PV.whatsappVerifyLink('27600000000', 'TV-482913');
    expect(text).toBe('Verify my ThabangVision number: TV-482913');
    expect(link).toBe(`https://wa.me/27600000000?text=${encodeURIComponent(text)}`);
  });
  it('reads only inbound text messages from a payload; statuses are ignored', () => {
    expect(parseMetaInbound(JSON.parse(payload(WA_SENDER, 'hi')))).toEqual([
      { from: WA_SENDER, body: 'hi', messageId: 'wamid.ONE', timestamp: '1760000000' },
    ]);
    const statuses = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] };
    expect(parseMetaInbound(statuses)).toEqual([]);
    expect(parseMetaInbound({ object: 'page' })).toEqual([]);
    expect(parseMetaInbound(null)).toEqual([]);
  });
  it('maps a wa_id to a normalised SA mobile', () => {
    expect(PV.waIdToSaMobile('27821234567')).toBe('+27821234567');
    expect(PV.waIdToSaMobile('447700900123')).toBeNull();
  });
  it('a WhatsApp code shown on screen can never pass the SMS check', () => {
    const waHash = PV.whatsappCodeHash('482913', USER, CODE_SECRET);
    expect(codesMatch(hashCode('482913', USER, CODE_SECRET), waHash)).toBe(false);
  });
});

// ─── Confirming ────────────────────────────────────────────────────────────

describe('confirming a number from the webhook', () => {
  const msg = 'Verify my ThabangVision number: TV-482913';

  it('success: sets phone and phone_verified_at, deletes the code, replies once', async () => {
    const store = state.store as MemoryStore;
    seed(store);
    const body = payload(WA_SENDER, msg);
    const res = await POST(post(body, sign(body)));
    expect(res.status).toBe(200);
    expect(store.profiles.get(USER)?.phone).toBe(ENTERED);
    expect(store.profiles.get(USER)?.phone_verified_at).toBeTruthy();
    expect(store.codes.size).toBe(0);
    expect(state.events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/1234567890\/messages$/);
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ messaging_product: 'whatsapp', to: WA_SENDER, type: 'text' });
  });

  it('a sender number different from the entered number is rejected', async () => {
    const store = state.store as MemoryStore;
    seed(store, { phone: '+27831112222' });
    const body = payload(WA_SENDER, msg);
    expect((await POST(post(body, sign(body)))).status).toBe(200);
    expect(store.profiles.size).toBe(0);
    expect(store.codes.size).toBe(1);
  });

  it('only the account whose code was sent is confirmed when two accounts claim the number', async () => {
    const store = state.store as MemoryStore;
    seed(store, { user: USER, digits: '482913' });
    seed(store, { user: OTHER, digits: '111111' });
    const out = await PV.confirmFromWhatsApp({ from: WA_SENDER, body: msg }, { store, secret: CODE_SECRET });
    expect(out).toEqual({ kind: 'confirmed', userId: USER, phone: ENTERED });
    expect(store.profiles.has(OTHER)).toBe(false);
  });

  it('a duplicate delivery is idempotent: one confirmation, one reply', async () => {
    const store = state.store as MemoryStore;
    seed(store);
    const body = payload(WA_SENDER, msg);
    expect((await POST(post(body, sign(body)))).status).toBe(200);
    const firstAt = store.profiles.get(USER)?.phone_verified_at;
    expect((await POST(post(body, sign(body)))).status).toBe(200);
    expect(store.markCalls).toBe(1);
    expect(store.profiles.get(USER)?.phone_verified_at).toBe(firstAt);
    expect(state.events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an expired code is rejected', async () => {
    const store = state.store as MemoryStore;
    seed(store, { expiresInMs: -1_000 });
    const body = payload(WA_SENDER, msg);
    expect((await POST(post(body, sign(body)))).status).toBe(200);
    expect(store.profiles.size).toBe(0);
    // And the core refuses it even if a store returned it.
    const stale: PhoneVerifyStore = { ...store, pendingForPhone: async () => [...store.codes.values()], markVerified: store.markVerified.bind(store), consume: store.consume.bind(store) };
    expect((await PV.confirmFromWhatsApp({ from: WA_SENDER, body: msg }, { store: stale, secret: CODE_SECRET })).kind).toBe('no_match');
  });

  it('unknown codes and plain chat change nothing; plain chat gets no reply', async () => {
    const store = state.store as MemoryStore;
    seed(store);
    const wrong = payload(WA_SENDER, 'TV-000000', 'wamid.W');
    expect((await POST(post(wrong, sign(wrong)))).status).toBe(200);
    const chat = payload(WA_SENDER, 'hello there', 'wamid.C');
    expect((await POST(post(chat, sign(chat)))).status).toBe(200);
    expect(store.profiles.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the "could not match" reply
  });

  it('no reply is attempted when the sending credentials are not set', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const store = state.store as MemoryStore;
    seed(store);
    const body = payload(WA_SENDER, msg);
    expect((await POST(post(body, sign(body)))).status).toBe(200);
    expect(store.profiles.get(USER)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Channel selection ─────────────────────────────────────────────────────

describe('channel selection', () => {
  const pick = (setting: string | undefined, whatsappReady: boolean, smsReady: boolean, secretSet = true) =>
    PV.resolvePhoneVerifyChannel({ setting, whatsappReady, smsReady, secretSet });

  it('follows PHONE_VERIFY_CHANNEL when that channel is configured', () => {
    expect(pick('whatsapp', true, true)).toBe('whatsapp');
    expect(pick('sms', true, true)).toBe('sms');
    expect(pick('SMS', false, true)).toBe('sms');
  });
  it('is off when the chosen channel is not configured (no silent switch)', () => {
    expect(pick('whatsapp', false, true)).toBe('off');
    expect(pick('sms', true, false)).toBe('off');
    expect(pick('off', true, true)).toBe('off');
  });
  it('unset: WhatsApp first, then SMS, else off', () => {
    expect(pick(undefined, true, true)).toBe('whatsapp');
    expect(pick(undefined, false, true)).toBe('sms');
    expect(pick(undefined, false, false)).toBe('off');
  });
  it('is off without the code-hashing secret', () => {
    expect(pick('whatsapp', true, true, false)).toBe('off');
  });
  it('WhatsApp is ready only with token, secret and a valid business number', () => {
    expect(PV.whatsappVerifyReady({ WHATSAPP_VERIFY_TOKEN: 't', WHATSAPP_APP_SECRET: 's', WHATSAPP_BUSINESS_NUMBER: '+27 60 000 0000' })).toBe(true);
    expect(PV.whatsappVerifyReady({ WHATSAPP_VERIFY_TOKEN: 't', WHATSAPP_APP_SECRET: 's' })).toBe(false);
    expect(PV.whatsappVerifyReady({ WHATSAPP_APP_SECRET: 's', WHATSAPP_BUSINESS_NUMBER: '+27600000000' })).toBe(false);
    expect(PV.whatsappBusinessDigits({ WHATSAPP_BUSINESS_NUMBER: '+27 60 000 0000' })).toBe('27600000000');
    expect(PV.whatsappBusinessDigits({ WHATSAPP_BUSINESS_NUMBER: 'abc' })).toBeNull();
  });
});
